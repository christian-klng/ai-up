import { z } from "zod";
import { registerTrigger } from "../registry";

const contentTypeList = z.array(z.enum(["markdown", "image", "video", "link"])).default([]);

const contentConfig = z.object({
  contentTypes: contentTypeList,
  areaIds: z.array(z.string().uuid()).default([]),
  /** Also fire for content created by workflows (default false to avoid loops) */
  includeWorkflowOrigin: z.boolean().default(false),
});
type ContentConfig = z.infer<typeof contentConfig>;

const contentFields = [
  { key: "contentTypes", type: "content-types" as const, label: { de: "Inhaltstypen", en: "Content types" }, help: { de: "Leer = alle Typen.", en: "Empty = all types." } },
  { key: "areaIds", type: "area" as const, label: { de: "Wissensbereiche", en: "Knowledge areas" }, help: { de: "Leer = alle Bereiche.", en: "Empty = all areas." } },
  { key: "includeWorkflowOrigin", type: "boolean" as const, label: { de: "Auch von Workflows erzeugte Inhalte", en: "Also content created by workflows" }, help: { de: "Vorsicht: kann Schleifen erzeugen.", en: "Careful: can create loops." } },
];

const contentPayloadDoc = {
  "content.id": "uuid of the content",
  "content.type": "markdown | image | video | link",
  "content.title": "title",
  "content.url": "external url (link/video/image by url) or null",
  "content.body": "markdown body or note (may be null)",
  "content.areaId": "knowledge area id",
  "content.areaName": "knowledge area name",
  "content.areaPurpose": "purpose text of the area",
  "content.authorId": "user id of the author",
  "content.authorName": "author display name",
  "content.versionNo": "version number",
  "content.href": "app-relative link to the content",
};

const contentSample = {
  content: { id: "00000000-0000-0000-0000-000000000000", type: "link", title: "Example article", url: "https://example.com/article", body: null, areaId: "…", areaName: "Tools", areaPurpose: "…", authorId: "…", authorName: "Jane", versionNo: 1, href: "/knowledge/tools/…" },
  origin: { kind: "user" },
};

function matchesContent(config: ContentConfig, payload: Record<string, unknown>): boolean {
  const c = payload.content as { type?: string; areaId?: string } | undefined;
  const origin = payload.origin as { kind?: string } | undefined;
  if (!c) return false;
  if (origin?.kind === "workflow" && !config.includeWorkflowOrigin) return false;
  if (config.contentTypes.length && !config.contentTypes.includes(c.type as never)) return false;
  if (config.areaIds.length && !config.areaIds.includes(c.areaId ?? "")) return false;
  return true;
}

registerTrigger<ContentConfig>({
  type: "content.created",
  labels: { name: { de: "Inhalt erstellt", en: "Content created" }, description: { de: "Startet, wenn ein neuer Inhalt (Text, Bild, Video oder Link) gespeichert wird.", en: "Fires when a new content item (text, image, video or link) is saved." } },
  doc: "Fires when a member creates a content item in a knowledge area. Filter by content type and/or area.",
  configSchema: contentConfig,
  fields: contentFields,
  payloadDoc: contentPayloadDoc,
  samplePayload: contentSample,
  matches: matchesContent,
  eventTypes: ["content.created"],
});

registerTrigger<ContentConfig>({
  type: "content.updated",
  labels: { name: { de: "Inhalt aktualisiert", en: "Content updated" }, description: { de: "Startet, wenn eine neue Version eines Inhalts gespeichert wird.", en: "Fires when a new version of a content item is saved." } },
  doc: "Fires when a content item gets a new version. Filter by content type and/or area.",
  configSchema: contentConfig,
  fields: contentFields,
  payloadDoc: contentPayloadDoc,
  samplePayload: { ...contentSample, content: { ...contentSample.content, versionNo: 2 } },
  matches: matchesContent,
  eventTypes: ["content.updated"],
});

const scheduleConfig = z
  .object({
    mode: z.enum(["preset", "every", "cron"]).default("preset"),
    preset: z.enum(["weekdays_9", "daily_9", "hourly", "weekly_mon_9"]).default("weekdays_9"),
    everyMinutes: z.coerce.number().int().min(5).max(10080).default(30),
    cron: z.string().trim().default("0 9 * * 1-5"),
    timezone: z.string().trim().default("Europe/Berlin"),
  })
  .strict();
export type ScheduleConfig = z.infer<typeof scheduleConfig>;

registerTrigger<ScheduleConfig>({
  type: "schedule",
  labels: { name: { de: "Zeitplan", en: "Schedule" }, description: { de: "Startet regelmäßig, z. B. jeden Wochentag um 9 Uhr oder alle 30 Minuten.", en: "Runs on a schedule, e.g. every weekday at 9:00 or every 30 minutes." } },
  doc: "Time-based trigger. mode=preset (weekdays_9 | daily_9 | hourly | weekly_mon_9), mode=every (everyMinutes), or mode=cron (5-field cron expression). Timezone defaults to Europe/Berlin.",
  configSchema: scheduleConfig,
  fields: [
    { key: "mode", type: "select", label: { de: "Art", en: "Mode" }, required: true, options: [
      { value: "preset", label: { de: "Vorlage", en: "Preset" } },
      { value: "every", label: { de: "Alle N Minuten", en: "Every N minutes" } },
      { value: "cron", label: { de: "Cron-Ausdruck", en: "Cron expression" } },
    ] },
    { key: "preset", type: "select", label: { de: "Vorlage", en: "Preset" }, showIf: { key: "mode", equals: "preset" }, options: [
      { value: "weekdays_9", label: { de: "Jeden Wochentag um 09:00", en: "Every weekday at 09:00" } },
      { value: "daily_9", label: { de: "Täglich um 09:00", en: "Daily at 09:00" } },
      { value: "hourly", label: { de: "Stündlich", en: "Hourly" } },
      { value: "weekly_mon_9", label: { de: "Montags um 09:00", en: "Mondays at 09:00" } },
    ] },
    { key: "everyMinutes", type: "number", label: { de: "Intervall (Minuten)", en: "Interval (minutes)" }, min: 5, max: 10080, showIf: { key: "mode", equals: "every" } },
    { key: "cron", type: "cron", label: { de: "Cron-Ausdruck", en: "Cron expression" }, placeholder: "0 9 * * 1-5", showIf: { key: "mode", equals: "cron" }, help: { de: "Minute Stunde Tag Monat Wochentag", en: "minute hour day month weekday" } },
    { key: "timezone", type: "text", label: { de: "Zeitzone", en: "Timezone" }, placeholder: "Europe/Berlin" },
  ],
  payloadDoc: { scheduledFor: "ISO timestamp of the scheduled slot", firedAt: "ISO timestamp when the run was created" },
  samplePayload: { scheduledFor: new Date().toISOString(), firedAt: new Date().toISOString() },
});

const PRESET_CRON: Record<ScheduleConfig["preset"], string> = { weekdays_9: "0 9 * * 1-5", daily_9: "0 9 * * *", hourly: "0 * * * *", weekly_mon_9: "0 9 * * 1" };

/** Converts schedule config into BullMQ job scheduler options. */
export function scheduleToRepeat(config: ScheduleConfig): { pattern?: string; every?: number; tz?: string } {
  if (config.mode === "every") return { every: config.everyMinutes * 60_000 };
  const pattern = config.mode === "cron" ? config.cron : PRESET_CRON[config.preset];
  return { pattern, tz: config.timezone || "Europe/Berlin" };
}

const manualConfig = z.object({}).passthrough();
registerTrigger<Record<string, unknown>>({
  type: "manual",
  labels: { name: { de: "Manuell", en: "Manual" }, description: { de: "Wird von einem Admin in der App oder per MCP gestartet, optional mit Eingabedaten.", en: "Started by an admin in the app or via MCP, optionally with input data." } },
  doc: "No automatic trigger. Run from the admin UI or via MCP `trigger_workflow` with an arbitrary JSON `input`.",
  configSchema: manualConfig,
  fields: [],
  payloadDoc: { input: "arbitrary JSON passed when starting the run", startedBy: "user id" },
  samplePayload: { input: { topic: "example" } },
});

const questionAnsweredConfig = z.object({
  /** empty = any question */
  questionKey: z.string().trim().default(""),
});
registerTrigger<z.infer<typeof questionAnsweredConfig>>({
  type: "question.answered",
  labels: { name: { de: "Frage beantwortet", en: "Question answered" }, description: { de: "Startet, wenn ein Mitglied eine Frage (Aktion „Dem Nutzer Frage stellen“) beantwortet.", en: "Fires when a member answers a question (action “Ask the user”)." } },
  doc: "Fires on every answer to a question created by the ask_user action. Filter by questionKey (empty = all). Payload: question {id,key,title}, response.answers (by field key), user {id,name}, stats {responses, distribution}.",
  configSchema: questionAnsweredConfig,
  fields: [{ key: "questionKey", type: "question-key", label: { de: "Frage-Schlüssel", en: "Question key" }, help: { de: "Leer = jede Frage.", en: "Empty = any question." } }],
  payloadDoc: {
    "question.id": "question id",
    "question.key": "questionKey from the ask_user step",
    "question.title": "question title",
    "response.answers": "object keyed by field key, e.g. {{ trigger.response.answers.mood }}",
    "user.id": "answering user id",
    "user.name": "answering user name",
    "stats.responses": "number of responses so far",
    "stats.distribution": "per field: counts per option",
  },
  samplePayload: { question: { id: "…", key: "weekly_mood", title: "How was your week?" }, response: { answers: { mood: "Gut", comment: "Alles bestens" }, answeredAt: new Date().toISOString() }, user: { id: "…", name: "Jane" }, stats: { responses: 3, distribution: { mood: { Gut: 2, Mittel: 1 } } } },
  matches: (config, payload) => {
    const q = payload.question as { key?: string } | undefined;
    return !config.questionKey || q?.key === config.questionKey;
  },
  eventTypes: ["question.answered"],
});

const botMessageConfig = z.object({
  /** optional substring/regex the message must match (case-insensitive); empty = all */
  contains: z.string().trim().default(""),
});
registerTrigger<z.infer<typeof botMessageConfig>>({
  type: "bot.message.received",
  labels: { name: { de: "Nachricht an den Bot", en: "Message to the bot" }, description: { de: "Startet, wenn ein Mitglied dem System-Bot im Messenger schreibt – z. B. um per LLM zu antworten (Aktion „Nachricht senden“).", en: "Fires when a member writes to the system bot in the messenger – e.g. to reply via LLM (action “Send message”)." } },
  doc: "Fires for every message a member sends in a conversation with the system bot. Optional `contains` filter (case-insensitive substring). Payload: text, user {id,name}, conversationId, attachments. Reply with action send_message (audience triggerUser).",
  configSchema: botMessageConfig,
  fields: [{ key: "contains", type: "text", label: { de: "Enthält (optional)", en: "Contains (optional)" }, help: { de: "Nur auslösen, wenn die Nachricht diesen Text enthält.", en: "Only fire when the message contains this text." } }],
  payloadDoc: { text: "message text", "user.id": "sender id", "user.name": "sender name", conversationId: "conversation id", attachments: "attachments array", messageId: "message id" },
  samplePayload: { text: "Hallo Bot, was gibt es Neues?", user: { id: "…", name: "Jane" }, conversationId: "…", attachments: [], messageId: "…" },
  matches: (config, payload) => !config.contains || String(payload.text ?? "").toLowerCase().includes(config.contains.toLowerCase()),
  eventTypes: ["bot.message.received"],
});
