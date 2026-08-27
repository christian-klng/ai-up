import { readFile } from "node:fs/promises";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { registerAction } from "../registry";
import type { ActionRunContext } from "../types";
import { db } from "@/server/db/client";
import { mediaFiles, users } from "@/server/db/schema";
import { createNotifications } from "@/server/domain/notifications";
import { createContent, getAreaById } from "@/server/domain/knowledge";
import { buildStructuredVersionInput } from "@/server/domain/structured-entries";
import { getTemplateBySystemKey } from "@/server/domain/templates";
import { getSpaceById, setMeetingTranscript } from "@/server/domain/meetings";
import { absolutePath } from "@/server/media/storage";
import { readWebpage } from "@/server/webreader/read-webpage";
import { modelCapabilities } from "@/server/llm/client";
import { chatCompletion } from "@/server/llm/client";
import { clientConfigFor, getDefaultProvider, getProvider, resolveModel } from "@/server/llm/providers";
import { transcribeAudio, transcriptToMarkdown } from "@/server/llm/stt";

// ---------------------------------------------------------------------------
// llm
// ---------------------------------------------------------------------------

const jsonSchemaField = z
  .union([z.record(z.string(), z.unknown()), z.string()])
  .optional()
  .transform((v) => {
    if (!v) return undefined;
    if (typeof v === "string") {
      if (!v.trim()) return undefined;
      return JSON.parse(v) as Record<string, unknown>;
    }
    return v;
  });

const llmConfig = z.object({
  providerId: z.string().default("default"),
  model: z.string().default("default"),
  systemPrompt: z.string().default(""),
  prompt: z.string().min(1, "prompt is required"),
  temperature: z.coerce.number().min(0).max(2).optional(),
  topP: z.coerce.number().min(0).max(1).optional(),
  maxTokens: z.coerce.number().int().positive().optional(),
  reasoningEffort: z.enum(["none", "low", "medium", "high"]).optional(),
  outputSchema: jsonSchemaField,
  jsonMode: z.boolean().optional(),
  stopSequences: z.array(z.string()).optional(),
  seed: z.coerce.number().int().optional(),
});
export type LlmActionConfig = z.infer<typeof llmConfig>;

/** Pulls the first JSON object/array out of a text answer (fallback when the model ignores response_format). */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidates = [trimmed, fenced?.[1] ?? ""];
  for (const c of candidates) {
    if (!c) continue;
    try {
      return JSON.parse(c);
    } catch {
      /* try slicing */
    }
    const start = Math.min(...["{", "["].map((ch) => c.indexOf(ch)).filter((i) => i >= 0));
    if (Number.isFinite(start)) {
      const end = Math.max(c.lastIndexOf("}"), c.lastIndexOf("]"));
      if (end > start) {
        try {
          return JSON.parse(c.slice(start, end + 1));
        } catch {
          /* give up */
        }
      }
    }
  }
  return undefined;
}

registerAction<LlmActionConfig>({
  type: "llm",
  labels: { name: { de: "LLM", en: "LLM" }, description: { de: "Ruft ein Sprachmodell über den konfigurierten OpenAI-kompatiblen Endpunkt auf.", en: "Calls a language model via the configured OpenAI-compatible endpoint." } },
  doc: "Chat completion against an OpenAI-compatible provider. `prompt` and `systemPrompt` are Liquid templates (use {{ trigger.* }}, {{ steps.<id>.output.* }}, {{ app.purpose }}). Provide `outputSchema` (JSON Schema) to get structured output in `output.json` – the engine uses response_format when the model supports it and falls back to instructing + parsing. `reasoningEffort` maps to OpenRouter `reasoning.effort` / OpenAI `reasoning_effort` when supported. Use providerId/model \"default\" for the admin's default provider/model.",
  configSchema: llmConfig,
  fields: [
    { key: "providerId", type: "llm-model", label: { de: "Provider & Modell", en: "Provider & model" }, required: true },
    { key: "systemPrompt", type: "template", label: { de: "System-Prompt", en: "System prompt" }, help: { de: "Wird um den Community-Zweck ergänzt: {{ app.purpose }}", en: "Tip: embed the community purpose with {{ app.purpose }}" } },
    { key: "prompt", type: "template", label: { de: "Prompt", en: "Prompt" }, required: true, placeholder: "Summarize:\n\n{{ steps.read.output.markdown }}" },
    { key: "temperature", type: "number", label: { de: "Temperatur", en: "Temperature" }, min: 0, max: 2, step: 0.1 },
    { key: "maxTokens", type: "number", label: { de: "Max. Tokens", en: "Max tokens" }, min: 1 },
    { key: "reasoningEffort", type: "select", label: { de: "Thinking-Level", en: "Reasoning effort" }, options: [
      { value: "none", label: { de: "Aus", en: "Off" } },
      { value: "low", label: { de: "Niedrig", en: "Low" } },
      { value: "medium", label: { de: "Mittel", en: "Medium" } },
      { value: "high", label: { de: "Hoch", en: "High" } },
    ] },
    { key: "outputSchema", type: "json", label: { de: "Erwartete Ausgabe (JSON Schema)", en: "Expected output (JSON Schema)" }, help: { de: "Optional. Ergebnis steht dann unter output.json.", en: "Optional. Result is available as output.json." }, placeholder: '{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"]}' },
  ],
  templateKeys: ["systemPrompt", "prompt"],
  outputDoc: { text: "raw model answer", json: "parsed JSON when outputSchema/jsonMode was set", model: "model id used", finishReason: "provider finish reason", usage: "{promptTokens, completionTokens, totalTokens, cost}" },
  timeoutMs: 180_000,
  async run(config, ctx) {
    const { provider, model, info } = await resolveModel(config.providerId, config.model);
    const caps = modelCapabilities(info, provider.kind);
    const cfg = await clientConfigFor(provider);
    const messages: { role: "system" | "user"; content: string }[] = [];
    let system = config.systemPrompt?.trim() ?? "";
    const wantsJson = !!config.outputSchema || !!config.jsonMode;
    const useNativeSchema = !!config.outputSchema && caps.structuredOutputs;
    if (wantsJson && !useNativeSchema) {
      system += `${system ? "\n\n" : ""}Respond with a single valid JSON document only – no prose, no markdown fences.${config.outputSchema ? ` It must conform to this JSON Schema:\n${JSON.stringify(config.outputSchema)}` : ""}`;
    }
    if (system) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: config.prompt });

    const call = () =>
      chatCompletion(cfg, {
        model,
        messages,
        temperature: caps.temperature ? config.temperature : undefined,
        topP: caps.topP ? config.topP : undefined,
        maxTokens: caps.maxTokens ? config.maxTokens : undefined,
        stopSequences: caps.stop ? config.stopSequences : undefined,
        seed: caps.seed ? config.seed : undefined,
        reasoningEffort: caps.reasoning ? config.reasoningEffort : undefined,
        jsonSchema: useNativeSchema ? config.outputSchema : undefined,
        jsonMode: !useNativeSchema && wantsJson && caps.structuredOutputs ? true : undefined,
        timeoutMs: 170_000,
      });

    let res = await call();
    let json: unknown = undefined;
    if (wantsJson) {
      json = extractJson(res.text);
      if (json === undefined) {
        ctx.log("model answer was not valid JSON – retrying once");
        messages.push({ role: "user", content: "Your previous answer was not valid JSON. Answer again with valid JSON only." });
        res = await call();
        json = extractJson(res.text);
        if (json === undefined) throw new Error("LLM did not return valid JSON");
      }
    }
    return {
      output: { text: res.text, json: json ?? null, model: res.model, finishReason: res.finishReason, usage: res.usage, provider: provider.name },
      usage: { ...res.usage, model: res.model },
    };
  },
});

// ---------------------------------------------------------------------------
// read_webpage
// ---------------------------------------------------------------------------

const readConfig = z.object({
  url: z.string().min(1, "url is required"),
  maxChars: z.coerce.number().int().min(500).max(200_000).default(60_000),
});
registerAction<z.infer<typeof readConfig>>({
  type: "read_webpage",
  labels: { name: { de: "Webseite lesen", en: "Read webpage" }, description: { de: "Lädt eine URL und extrahiert nur den lesbaren Hauptinhalt (z. B. Artikeltext) als Markdown.", en: "Fetches a URL and extracts only the human-readable main content (e.g. article text) as Markdown." } },
  doc: "Downloads the page (public URLs only) and extracts the readable article with Mozilla Readability. Output: markdown, text, title, byline, siteName, excerpt, wordCount, lang, publishedAt.",
  configSchema: readConfig,
  fields: [
    { key: "url", type: "template", label: { de: "URL", en: "URL" }, required: true, placeholder: "{{ trigger.content.url }}" },
    { key: "maxChars", type: "number", label: { de: "Max. Zeichen", en: "Max characters" }, min: 500, max: 200000 },
  ],
  templateKeys: ["url"],
  outputDoc: { markdown: "readable content as Markdown", text: "plain text", title: "page title", byline: "author if detected", siteName: "site name", excerpt: "short description", wordCount: "number of words", lang: "language code", publishedAt: "publish date if detected", finalUrl: "url after redirects", truncated: "true if cut at maxChars" },
  timeoutMs: 40_000,
  async run(config) {
    const r = await readWebpage(config.url, { maxChars: config.maxChars });
    return { output: { ...r } };
  },
});

// ---------------------------------------------------------------------------
// transcribe
// ---------------------------------------------------------------------------

/** OpenAI's /audio/transcriptions rejects larger uploads; chunking is out of scope here. */
const MAX_TRANSCRIBE_BYTES = 25 * 1024 * 1024;

const transcribeConfig = z.object({
  mediaId: z.string().uuid("mediaId must be a media file id"),
  providerId: z.string().default("default"),
  model: z
    .string()
    .default("whisper-1")
    .transform((v) => v.trim() || "whisper-1"),
  language: z.string().default(""),
  prompt: z.string().default(""),
});
registerAction<z.infer<typeof transcribeConfig>>({
  type: "transcribe",
  labels: {
    name: { de: "Audio transkribieren", en: "Transcribe audio" },
    description: { de: "Wandelt eine Audiodatei (z. B. den Meeting-Mitschnitt) per Speech-to-Text in Text um.", en: "Converts an audio file (e.g. the meeting recording) to text via speech-to-text." },
  },
  doc: "Transcribes a media file via an OpenAI-compatible `/audio/transcriptions` endpoint (OpenAI whisper-1/gpt-4o-transcribe, Groq, self-hosted Whisper; OpenRouter has no such endpoint). `mediaId` is a Liquid template – with the meeting.recording.available trigger use {{ trigger.mediaId }}. `language` is an ISO 639-1 code (empty = auto-detect), `prompt` an optional context hint (names, jargon). Files over 25 MB are rejected. Output: text, markdown (with [m:ss] stamps), language, durationSeconds, segments.",
  configSchema: transcribeConfig,
  fields: [
    { key: "mediaId", type: "template", label: { de: "Audiodatei (Media-ID)", en: "Audio file (media id)" }, required: true, placeholder: "{{ trigger.mediaId }}" },
    { key: "providerId", type: "llm-provider", label: { de: "Provider", en: "Provider" }, required: true, help: { de: "Muss einen OpenAI-kompatiblen Endpunkt /audio/transcriptions anbieten (OpenAI, Groq, eigenes Whisper) – OpenRouter nicht.", en: "Must offer an OpenAI-compatible /audio/transcriptions endpoint (OpenAI, Groq, self-hosted Whisper) – not OpenRouter." } },
    { key: "model", type: "text", label: { de: "Modell", en: "Model" }, placeholder: "whisper-1" },
    { key: "language", type: "text", label: { de: "Sprache (ISO-Code, leer = automatisch)", en: "Language (ISO code, empty = auto)" }, placeholder: "de" },
    { key: "prompt", type: "template", label: { de: "Kontext-Hinweis (optional)", en: "Context hint (optional)" }, placeholder: "AI-Up, LiveKit, Coolify" },
  ],
  templateKeys: ["mediaId", "prompt"],
  outputDoc: {
    text: "plain transcript",
    markdown: "transcript as markdown with [m:ss] timestamps",
    language: "detected/requested language code",
    durationSeconds: "audio length in seconds",
    segments: "array of {start, end, text}",
    model: "model id used",
  },
  timeoutMs: 600_000,
  async run(config, ctx) {
    const media = await db.query.mediaFiles.findFirst({ where: eq(mediaFiles.id, config.mediaId) });
    if (!media) throw new Error(`media file ${config.mediaId} not found`);
    if (media.kind !== "audio" && media.kind !== "video") throw new Error(`media file is ${media.kind}, expected audio/video`);
    if (media.size > MAX_TRANSCRIBE_BYTES) throw new Error(`file is ${Math.round(media.size / 1024 / 1024)} MB – the transcription endpoint accepts at most 25 MB`);
    const provider = config.providerId && config.providerId !== "default" ? await getProvider(config.providerId) : await getDefaultProvider();
    if (!provider) throw new Error("No LLM provider configured. Add one under Admin → LLM.");
    const buffer = await readFile(absolutePath(media.storagePath));
    ctx.log("transcribing", { mediaId: media.id, size: media.size, provider: provider.name, model: config.model });
    const result = await transcribeAudio(await clientConfigFor(provider), {
      model: config.model,
      buffer,
      filename: media.originalName,
      mime: media.mime,
      language: config.language,
      prompt: config.prompt,
      timeoutMs: 590_000,
    });
    return {
      output: {
        text: result.text,
        markdown: transcriptToMarkdown(result),
        language: result.language,
        durationSeconds: result.durationSeconds ?? media.durationSeconds,
        segments: result.segments,
        model: config.model,
        provider: provider.name,
      },
    };
  },
});

// ---------------------------------------------------------------------------
// set_meeting_transcript
// ---------------------------------------------------------------------------

const setTranscriptConfig = z.object({
  meetingId: z.string().uuid("meetingId must be a meeting id"),
  markdown: z.string().min(1, "markdown is required"),
  mode: z.enum(["append", "replace"]).default("append"),
});
registerAction<z.infer<typeof setTranscriptConfig>>({
  type: "set_meeting_transcript",
  labels: {
    name: { de: "Meeting-Transkript speichern", en: "Save meeting transcript" },
    description: { de: "Hinterlegt das Transkript (Markdown) am Meeting – sichtbar auf der Meeting-Seite.", en: "Stores the transcript (markdown) on the meeting – shown on the meeting page." },
  },
  doc: "Sets the transcript of a meeting. `mode: \"append\"` (default) adds the markdown as a new dated section below an existing transcript (so re-recorded sessions of a reopened meeting are kept); `mode: \"replace\"` overwrites it. `meetingId` and `markdown` are Liquid templates – with the meeting.recording.available trigger use {{ trigger.meeting.id }} and e.g. {{ steps.transcribe.output.markdown }}.",
  configSchema: setTranscriptConfig,
  fields: [
    { key: "meetingId", type: "template", label: { de: "Meeting-ID", en: "Meeting id" }, required: true, placeholder: "{{ trigger.meeting.id }}" },
    { key: "markdown", type: "template", label: { de: "Transkript (Markdown)", en: "Transcript (markdown)" }, required: true, placeholder: "{{ steps.transcribe.output.markdown }}" },
    { key: "mode", type: "select", label: { de: "Modus", en: "Mode" }, options: [
      { value: "append", label: { de: "Anhängen (neuer Abschnitt)", en: "Append (new section)" } },
      { value: "replace", label: { de: "Überschreiben", en: "Replace" } },
    ] },
  ],
  templateKeys: ["meetingId", "markdown"],
  outputDoc: { meetingId: "id of the meeting", href: "app-relative link to the meeting" },
  timeoutMs: 15_000,
  async run(config) {
    const meeting = await setMeetingTranscript(config.meetingId, config.markdown, { mode: config.mode });
    if (!meeting) throw new Error(`meeting ${config.meetingId} not found`);
    const space = await getSpaceById(meeting.spaceId);
    return { output: { meetingId: meeting.id, href: `/meetings/${space?.slug ?? meeting.spaceId}/${meeting.id}` } };
  },
});

// ---------------------------------------------------------------------------
// notify_user
// ---------------------------------------------------------------------------

const audienceSchema = z.object({
  type: z.enum(["triggerUser", "admins", "all", "users"]).default("triggerUser"),
  userIds: z.array(z.string()).default([]),
});
const notifyConfig = z.object({
  audience: audienceSchema.default({ type: "triggerUser", userIds: [] }),
  title: z.string().min(1, "title is required"),
  body: z.string().default(""),
  href: z.string().default(""),
});
export type NotifyConfig = z.infer<typeof notifyConfig>;

export async function resolveAudience(audience: NotifyConfig["audience"], ctx: Pick<ActionRunContext, "triggeredBy" | "template">): Promise<string[]> {
  switch (audience.type) {
    case "triggerUser": {
      const t = ctx.template.trigger as { content?: { authorId?: string }; startedBy?: string; userId?: string; user?: { id?: string } };
      const id = t.content?.authorId ?? t.user?.id ?? t.userId ?? t.startedBy ?? ctx.triggeredBy;
      return id ? [id] : [];
    }
    case "admins":
      return (await db.select({ id: users.id }).from(users).where(eq(users.role, "admin"))).map((r) => r.id);
    case "all":
      return (await db.select({ id: users.id }).from(users).where(and(eq(users.status, "active"), eq(users.isBot, false)))).map((r) => r.id);
    case "users":
      return audience.userIds;
  }
}

registerAction<NotifyConfig>({
  type: "notify_user",
  labels: { name: { de: "Benachrichtigung senden", en: "Send notification" }, description: { de: "Erzeugt eine In-App-Benachrichtigung für Nutzer (Auslöser, Admins, alle oder ausgewählte).", en: "Creates an in-app notification for users (trigger user, admins, everyone or selected)." } },
  doc: "Sends an in-app notification. audience.type: triggerUser (author/starter of the trigger), admins, all, users (with userIds). title/body/href are Liquid templates; href is app-relative (e.g. /knowledge/<area>/<id>).",
  configSchema: notifyConfig,
  fields: [
    { key: "audience", type: "audience", label: { de: "Empfänger", en: "Audience" }, required: true },
    { key: "title", type: "template", label: { de: "Titel", en: "Title" }, required: true, placeholder: "Summary ready: {{ trigger.content.title }}" },
    { key: "body", type: "template", label: { de: "Text", en: "Body" }, placeholder: "{{ steps.summary.output.json.summary }}" },
    { key: "href", type: "template", label: { de: "Link (App-Pfad)", en: "Link (app path)" }, placeholder: "{{ trigger.content.href }}" },
  ],
  templateKeys: ["title", "body", "href"],
  outputDoc: { sent: "number of notifications created", userIds: "recipients" },
  timeoutMs: 15_000,
  async run(config, ctx) {
    const ids = [...new Set(await resolveAudience(config.audience, ctx))];
    if (!ids.length) return { output: { sent: 0, userIds: [] } };
    await createNotifications(
      ids.map((userId) => ({
        userId,
        type: "workflow.result",
        title: config.title.slice(0, 200),
        body: config.body?.slice(0, 2000) || null,
        data: { href: config.href || null, workflowId: ctx.workflowId, runId: ctx.runId },
      })),
    );
    return { output: { sent: ids.length, userIds: ids } };
  },
});

// ---------------------------------------------------------------------------
// create_content
// ---------------------------------------------------------------------------

const createContentConfig = z.object({
  areaId: z.string().uuid("areaId is required"),
  type: z.enum(["markdown", "link"]).default("markdown"),
  title: z.string().min(1, "title is required"),
  body: z.string().default(""),
  url: z.string().default(""),
});
registerAction<z.infer<typeof createContentConfig>>({
  type: "create_content",
  labels: { name: { de: "Inhalt anlegen", en: "Create content" }, description: { de: "Legt einen neuen Markdown- oder Link-Inhalt in einer Sammlung an (z. B. eine Zusammenfassung).", en: "Creates a new markdown or link content item in a collection (e.g. a summary)." } },
  doc: "Creates content in a collection (knowledge area) via the system templates: type markdown needs body; type link needs url (+ optional body as note). Entries are stored as structured entries with a template snapshot. Author = the run's triggering user, otherwise none. Emits content.created with origin.kind=workflow (triggers ignore it unless includeWorkflowOrigin).",
  configSchema: createContentConfig,
  fields: [
    { key: "areaId", type: "area", label: { de: "Sammlung", en: "Collection" }, required: true },
    { key: "type", type: "select", label: { de: "Typ", en: "Type" }, options: [
      { value: "markdown", label: { de: "Text", en: "Text" } },
      { value: "link", label: { de: "Link", en: "Link" } },
    ] },
    { key: "title", type: "template", label: { de: "Titel", en: "Title" }, required: true },
    { key: "body", type: "template", label: { de: "Text (Markdown)", en: "Body (Markdown)" } },
    { key: "url", type: "template", label: { de: "URL (bei Typ Link)", en: "URL (for type link)" }, showIf: { key: "type", equals: "link" } },
  ],
  templateKeys: ["title", "body", "url"],
  outputDoc: { contentId: "id of the new content", href: "app-relative link" },
  timeoutMs: 20_000,
  async run(config, ctx) {
    const area = await getAreaById(config.areaId);
    if (!area) throw new Error("knowledge area not found");
    if (config.type === "markdown" && !config.body.trim()) throw new Error("body is empty");
    if (config.type === "link" && !/^https?:\/\//i.test(config.url)) throw new Error("url must be http(s)");
    // Entries are created from the system templates (structured, with snapshot);
    // the per-collection template assignment is deliberately not enforced for automation.
    const template = await getTemplateBySystemKey(config.type === "link" ? "link" : "text");
    if (!template) throw new Error("system templates missing – run db:migrate");
    const answers = config.type === "link" ? { url: { url: config.url }, ...(config.body.trim() ? { note: config.body } : {}) } : { body: config.body };
    const built = await buildStructuredVersionInput({ structureId: template.id, structureVersion: template.version, definition: template.definition }, config.title.slice(0, 200), answers, {});
    if (!built.ok) throw new Error(`invalid content: ${JSON.stringify(built.issues)}`);
    const authorId = ctx.triggeredBy;
    const content = await createContent(area.id, "structured", built.input, authorId ?? null, { kind: "workflow", runId: ctx.runId, workflowId: ctx.workflowId, depth: ctx.depth + 1 });
    return { output: { contentId: content.id, href: `/knowledge/${area.slug}/${content.id}` } };
  },
});

// ---------------------------------------------------------------------------
// ask_user
// ---------------------------------------------------------------------------

const questionFieldSchema = z.discriminatedUnion("type", [
  z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), type: z.literal("single_choice"), label: z.string().min(1), options: z.array(z.string().min(1)).min(2).max(12), required: z.boolean().optional() }),
  z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), type: z.literal("multi_choice"), label: z.string().min(1), options: z.array(z.string().min(1)).min(2).max(12), required: z.boolean().optional() }),
  z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), type: z.literal("text"), label: z.string().min(1), placeholder: z.string().optional(), required: z.boolean().optional() }),
  z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), type: z.literal("rating"), label: z.string().min(1), max: z.number().int().min(2).max(10).optional(), required: z.boolean().optional() }),
  z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), type: z.literal("yes_no"), label: z.string().min(1), required: z.boolean().optional() }),
  z.object({ key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), type: z.literal("cta"), label: z.string().min(1), buttonLabel: z.string().min(1), href: z.string().optional() }),
]);

const fieldsInput = z
  .union([z.array(questionFieldSchema), z.string()])
  .transform((v, ctx) => {
    if (typeof v !== "string") return v;
    try {
      const parsed = z.array(questionFieldSchema).safeParse(JSON.parse(v));
      if (!parsed.success) {
        ctx.addIssue({ code: "custom", message: parsed.error.issues.map((i) => i.message).join("; ") });
        return z.NEVER;
      }
      return parsed.data;
    } catch {
      ctx.addIssue({ code: "custom", message: "fields must be a JSON array" });
      return z.NEVER;
    }
  });

const askUserConfig = z.object({
  questionKey: z.string().regex(/^[a-z][a-z0-9_\-]{1,59}$/, "questionKey: lowercase letters, digits, _ or - (2–60 chars)"),
  title: z.string().min(1, "title is required"),
  description: z.string().default(""),
  fields: fieldsInput,
  audience: audienceSchema.default({ type: "all", userIds: [] }),
  allowDismiss: z.boolean().default(true),
  expiresInHours: z.coerce.number().min(0).max(24 * 365).default(0),
});
export type AskUserConfig = z.infer<typeof askUserConfig>;

registerAction<AskUserConfig>({
  type: "ask_user",
  labels: { name: { de: "Dem Nutzer Frage stellen", en: "Ask the user" }, description: { de: "Zeigt ein Mini-Formular unten links (Umfrage, Bewertung, Call-to-Action). Antworten lösen den Trigger „Frage beantwortet“ aus.", en: "Shows a mini form bottom-left (survey, rating, call to action). Answers fire the “Question answered” trigger." } },
  doc: "Creates a question shown as a mini form in the bottom-left corner for the audience. `questionKey` is a stable id you reuse in a `question.answered` trigger to react to answers. `fields` is an array of {key,type,label,...} with type single_choice|multi_choice (options[]), text (placeholder), rating (max), yes_no, cta (buttonLabel, href). title/description are Liquid templates. expiresInHours 0 = no expiry.",
  configSchema: askUserConfig,
  fields: [
    { key: "questionKey", type: "text", label: { de: "Frage-Schlüssel", en: "Question key" }, required: true, placeholder: "weekly_mood", help: { de: "Stabile ID – darüber reagiert ein anderer Workflow mit dem Trigger „Frage beantwortet“.", en: "Stable id – another workflow reacts via the “Question answered” trigger." } },
    { key: "title", type: "template", label: { de: "Titel", en: "Title" }, required: true, placeholder: "Wie war dein Meeting heute?" },
    { key: "description", type: "template", label: { de: "Beschreibung", en: "Description" } },
    { key: "fields", type: "json", label: { de: "Felder (JSON)", en: "Fields (JSON)" }, required: true, placeholder: '[{"key":"mood","type":"single_choice","label":"Stimmung","options":["Gut","Mittel","Schlecht"],"required":true},{"key":"comment","type":"text","label":"Kommentar"}]', help: { de: "Typen: single_choice, multi_choice, text, rating, yes_no, cta", en: "Types: single_choice, multi_choice, text, rating, yes_no, cta" } },
    { key: "audience", type: "audience", label: { de: "Empfänger", en: "Audience" }, required: true },
    { key: "allowDismiss", type: "boolean", label: { de: "„Später“ erlauben", en: "Allow dismiss" } },
    { key: "expiresInHours", type: "number", label: { de: "Läuft ab nach (Stunden, 0 = nie)", en: "Expires after (hours, 0 = never)" }, min: 0 },
  ],
  templateKeys: ["title", "description"],
  outputDoc: { questionId: "id of the created question", questionKey: "the key", recipients: "number of targeted users (0 = everyone)" },
  timeoutMs: 15_000,
  async run(config, ctx) {
    const { createQuestion } = await import("@/server/domain/questions");
    const recipientIds = config.audience.type === "all" ? [] : [...new Set(await resolveAudience(config.audience, ctx))];
    const q = await createQuestion({
      questionKey: config.questionKey,
      title: config.title.slice(0, 200),
      description: config.description?.slice(0, 2000) || null,
      fields: config.fields,
      audience: config.audience,
      recipientIds,
      allowDismiss: config.allowDismiss,
      expiresAt: config.expiresInHours > 0 ? new Date(Date.now() + config.expiresInHours * 3_600_000) : null,
      workflowId: ctx.workflowId,
      runId: ctx.runId,
      stepId: ctx.stepId,
      workflowName: ctx.workflowName,
    });
    return { output: { questionId: q.id, questionKey: q.questionKey, recipients: recipientIds.length } };
  },
});

// ---------------------------------------------------------------------------
// send_message (system bot → messenger)
// ---------------------------------------------------------------------------

const sendMessageConfig = z.object({
  audience: audienceSchema.default({ type: "triggerUser", userIds: [] }),
  body: z.string().min(1, "body is required"),
});
registerAction<z.infer<typeof sendMessageConfig>>({
  type: "send_message",
  labels: { name: { de: "Nachricht senden (Bot)", en: "Send message (bot)" }, description: { de: "Schickt den Empfängern eine Chat-Nachricht vom System-Bot im Messenger – ohne Kontaktanfrage.", en: "Sends recipients a chat message from the system bot in the messenger – no contact request needed." } },
  doc: "Sends a messenger message from the system bot (name configurable under Admin → General) to the audience. A direct conversation bot↔user is created on demand. Replies to the bot fire the `bot.message.received` trigger. `body` is a Liquid template; plain text with line breaks.",
  configSchema: sendMessageConfig,
  fields: [
    { key: "audience", type: "audience", label: { de: "Empfänger", en: "Audience" }, required: true },
    { key: "body", type: "template", label: { de: "Nachricht", en: "Message" }, required: true, placeholder: "Hallo {{ trigger.user.name }}, …" },
  ],
  templateKeys: ["body"],
  outputDoc: { sent: "number of messages sent", conversationIds: "conversation ids per recipient" },
  timeoutMs: 30_000,
  async run(config, ctx) {
    const { sendBotMessage } = await import("@/server/domain/bot");
    const ids = [...new Set(await resolveAudience(config.audience, ctx))];
    const conversationIds: string[] = [];
    for (const userId of ids) {
      const r = await sendBotMessage(userId, config.body.slice(0, 10_000));
      if (r) conversationIds.push(r.conversationId);
    }
    return { output: { sent: conversationIds.length, conversationIds } };
  },
});
