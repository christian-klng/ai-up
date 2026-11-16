import { z } from "zod";
import { registerAction } from "../registry";
import { renderTemplate } from "../templates";
import { replyToSubmitter, setSubmissionResponse } from "@/server/domain/collection-forms";
import { addContentVersion, getContent } from "@/server/domain/knowledge";
import { buildStructuredVersionInput } from "@/server/domain/structured-entries";
import { botUserId } from "@/server/domain/bot";
import { FORM_RESPONSE_BODY_MAX, FORM_RESPONSE_TITLE_MAX } from "@/lib/collection-forms";
import type { StructureAnswers, StructureDefinition, StructureElement } from "@/lib/structures/types";

// ---------------------------------------------------------------------------
// Actions around a collection's public form (docs/externe-formulare.md 6):
// answer the sender on the form, write into the entry, mail the sender.
// ---------------------------------------------------------------------------

const submissionIdField = { key: "submissionId", type: "template" as const, label: { de: "Einsendung", en: "Submission" }, required: true, placeholder: "{{ trigger.submission.id }}" };

const respondConfig = z.object({
  submissionId: z.string().default("{{ trigger.submission.id }}"),
  style: z.enum(["form", "plain", "card", "celebrate"]).default("form"),
  title: z.string().default(""),
  body: z.string().min(1, "body is required"),
});

registerAction<z.infer<typeof respondConfig>>({
  type: "respond_to_submission",
  labels: {
    name: { de: "Einsender auf dem Formular antworten", en: "Answer the sender on the form" },
    description: { de: "Ersetzt die Erfolgsmeldung des Formulars für diese eine Einsendung – z. B. ein persönlicher Hinweis oder die Kategorie, in die das Anliegen einsortiert wurde.", en: "Replaces the form's success message for this one submission – a personal note, or the category the request was filed under." },
  },
  doc: `Writes the message the sender sees on the form after submitting (use with trigger form.submitted). The form only waits for it if "wait for the workflow's answer" is switched on for the form, and only for its configured number of seconds – answer early in the workflow; a late answer is stored but nobody is looking any more. title (max ${FORM_RESPONSE_TITLE_MAX}) and body (Markdown, max ${FORM_RESPONSE_BODY_MAX}, no HTML) are Liquid templates; an empty title keeps the form's own heading. style: form (as configured for the form), plain, card or celebrate. The text is shown to an anonymous person: never include internal data.`,
  configSchema: respondConfig,
  fields: [
    submissionIdField,
    { key: "style", type: "select", label: { de: "Design", en: "Design" }, options: [
      { value: "form", label: { de: "Wie im Formular eingestellt", en: "As configured for the form" } },
      { value: "plain", label: { de: "Schlicht", en: "Plain" } },
      { value: "card", label: { de: "Karte mit Symbol", en: "Card with icon" } },
      { value: "celebrate", label: { de: "Vollflächig", en: "Full width" } },
    ] },
    { key: "title", type: "template", label: { de: "Überschrift", en: "Heading" }, placeholder: "Danke, {{ trigger.submission.contact.name }}!" },
    { key: "body", type: "template", label: { de: "Text (Markdown)", en: "Text (Markdown)" }, required: true, placeholder: "{{ steps.classify.output.json.note }}" },
  ],
  templateKeys: ["submissionId", "title", "body"],
  outputDoc: { delivered: "true when the message was stored for the submission", submissionId: "the submission" },
  timeoutMs: 10_000,
  async run(config, ctx) {
    if (!config.body.trim()) throw new Error("body is empty");
    const submissionId = config.submissionId.trim();
    const delivered = await setSubmissionResponse(ctx.communityId, submissionId, { style: config.style === "form" ? null : config.style, title: config.title, body: config.body });
    if (!delivered) throw new Error("submission not found");
    return { output: { delivered, submissionId } };
  },
});

// ---------------------------------------------------------------------------
// update_entry
// ---------------------------------------------------------------------------

/** Element types a workflow may set – plain values; boards and graphs have their own tools. */
const SETTABLE: ReadonlySet<StructureElement["type"]> = new Set(["text", "textarea", "select", "chips", "checkbox", "markdown", "link"]);

const answersField = z.union([z.record(z.string(), z.unknown()), z.string()]).transform((v, ctx) => {
  if (typeof v !== "string") return v;
  try {
    const parsed: unknown = JSON.parse(v);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // reported below
  }
  ctx.addIssue({ code: "custom", message: "answers must be a JSON object: { \"<element key>\": <value> }" });
  return z.NEVER;
});

const updateEntryConfig = z.object({
  contentId: z.string().default("{{ trigger.content.id }}"),
  answers: answersField,
  changeNote: z.string().default(""),
});

registerAction<z.infer<typeof updateEntryConfig>>({
  type: "update_entry",
  labels: {
    name: { de: "Eintrag ergänzen", en: "Update entry" },
    description: { de: "Setzt einzelne Felder eines Eintrags – z. B. Kategorie oder Priorität einer Einsendung – und speichert das als neue Version.", en: "Sets single fields of an entry – the category or priority of a submission, say – and saves that as a new version." },
  },
  doc: 'Sets answers of a structured entry and saves a new version (author: the community\'s bot, origin.kind=workflow). answers is a JSON object keyed by the template\'s element keys; only the given keys change, null clears one. Values by element type: text/textarea/markdown → string, select → one of the options, chips → array of options, checkbox → boolean, link → { "url": "https://…" }. Boards, process graphs, images and videos cannot be set here. String values inside the JSON are Liquid templates, rendered one by one after the JSON was parsed – so the JSON itself must be valid as written, with templates only inside string values, e.g. { "category": "{{ steps.classify.output.json.category }}" }. Required fields the entry has not filled yet do not block the update. Fails for unknown keys, for values the element does not accept (e.g. a select option that does not exist) and for fields currently hidden by their showIf condition.',
  configSchema: updateEntryConfig,
  fields: [
    { key: "contentId", type: "template", label: { de: "Eintrag", en: "Entry" }, required: true, placeholder: "{{ trigger.content.id }}" },
    { key: "answers", type: "json", label: { de: "Felder (JSON)", en: "Fields (JSON)" }, required: true, placeholder: '{ "category": "{{ steps.classify.output.json.category }}" }', help: { de: "Schlüssel = Feld-Schlüssel der Vorlage. Nur die genannten Felder ändern sich.", en: "Keys = element keys of the template. Only the fields named here change." } },
    { key: "changeNote", type: "template", label: { de: "Änderungsnotiz", en: "Change note" } },
  ],
  // `answers` is rendered in run(), value by value: the JSON must be valid before any template is
  // filled in, so text from an LLM or a sender can never break (or rewrite) its structure.
  templateKeys: ["contentId", "changeNote"],
  outputDoc: { contentId: "the entry", versionNo: "number of the new version", changedKeys: "element keys that were set" },
  timeoutMs: 20_000,
  async run(config, ctx) {
    const existing = await getContent(ctx.communityId, config.contentId.trim());
    const prev = existing?.version?.meta.structure;
    if (!existing || existing.type !== "structured" || !prev) throw new Error("structured entry not found");

    const byKey = new Map(prev.definition.elements.map((el) => [el.key, el]));
    const merged: StructureAnswers = { ...prev.answers };
    const changedKeys: string[] = [];
    const render = async (v: unknown): Promise<unknown> => {
      if (typeof v === "string") return (await renderTemplate(v, ctx.template)).trim();
      if (Array.isArray(v)) return (await Promise.all(v.map(render))).filter((x) => x !== "");
      if (typeof v === "object" && v !== null) return Object.fromEntries(await Promise.all(Object.entries(v).map(async ([k, x]) => [k, await render(x)] as const)));
      return v;
    };
    for (const [key, raw] of Object.entries(config.answers)) {
      const value = await render(raw);
      const el = byKey.get(key);
      if (!el) throw new Error(`unknown field "${key}" – the entry's template has: ${[...byKey.keys()].join(", ")}`);
      if (!SETTABLE.has(el.type) || (el.type === "markdown" && el.multiple)) throw new Error(`field "${key}" (${el.type}) cannot be set by a workflow`);
      if (value === null || value === "") delete merged[key];
      else merged[key] = value as StructureAnswers[string];
      changedKeys.push(key);
    }
    if (!changedKeys.length) throw new Error("answers is empty");

    // A partial update: what the entry has not answered yet must not stand in the way.
    const lenient: StructureDefinition = { ...prev.definition, elements: prev.definition.elements.map((el) => ({ ...el, required: false })) };
    const built = await buildStructuredVersionInput(prev, existing.title, merged, {
      validateAs: lenient,
      prevEnrichment: prev.enrichment,
      prevAnswers: prev.answers,
      imageMediaId: existing.version?.mediaId ?? null,
      changeNote: config.changeNote.trim().slice(0, 500) || `Workflow: ${ctx.workflowName}`.slice(0, 500),
      // Entries from outside stay cheap: no preview fetches on behalf of an anonymous sender.
      skipLinkPreviews: existing.external,
    });
    if (!built.ok) throw new Error(`invalid answers: ${JSON.stringify(built.issues)}`);
    // The lenient check silently drops a value the element rejects – that must not look like success.
    const stored = built.input.meta?.structure?.answers ?? {};
    const dropped = changedKeys.filter((k) => merged[k] !== undefined && stored[k] === undefined);
    if (dropped.length) throw new Error(`value not accepted for: ${dropped.join(", ")} – wrong type or option, or the field is hidden by its showIf condition`);

    const updated = await addContentVersion(
      ctx.communityId,
      existing.id,
      built.input,
      botUserId(ctx.communityId),
      { kind: "workflow", runId: ctx.runId, workflowId: ctx.workflowId, depth: ctx.depth + 1 },
      // No evaluation for entries an anonymous sender caused – see queueEvaluation().
      { skipEvaluation: existing.external },
    );
    if (!updated) throw new Error("entry could not be saved");
    return { output: { contentId: updated.id, versionNo: updated.versionCount, changedKeys } };
  },
});

// ---------------------------------------------------------------------------
// reply_to_submitter
// ---------------------------------------------------------------------------

const replyConfig = z.object({
  submissionId: z.string().default("{{ trigger.submission.id }}"),
  subject: z.string().min(1, "subject is required"),
  body: z.string().min(1, "body is required"),
});

registerAction<z.infer<typeof replyConfig>>({
  type: "reply_to_submitter",
  labels: {
    name: { de: "Einsender per E-Mail antworten", en: "Answer the sender by e-mail" },
    description: { de: "Schickt dem Einsender eine E-Mail – nur wenn das Formular das erlaubt und die Person es angekreuzt hat. Höchstens eine Mail je Einsendung.", en: "Mails the sender – only if the form allows it and the person ticked the box. One mail per submission at most." },
  },
  doc: "Sends one e-mail to the person who made a submission. There is no recipient field: the address is the one stored with the submission. Sends only if the form has \"allow answers by e-mail\" switched on, the sender ticked the consent box and gave an address, no mail was sent for this submission yet, and the address got fewer than 3 such mails today; otherwise the step succeeds with sent=false and a reason (disabled | noConsent | alreadySent | addressLimit). subject and body are Liquid templates; the body is sent as plain text paragraphs (no HTML, no Markdown rendering) with a fixed footer naming the community and the form. The address was typed by an anonymous person and is not verified – do not echo what the sender wrote, and never include internal data.",
  configSchema: replyConfig,
  fields: [
    submissionIdField,
    { key: "subject", type: "template", label: { de: "Betreff", en: "Subject" }, required: true, placeholder: "Deine Anfrage: {{ trigger.content.title }}" },
    { key: "body", type: "template", label: { de: "Text", en: "Text" }, required: true },
  ],
  templateKeys: ["submissionId", "subject", "body"],
  outputDoc: { sent: "true when the mail went out", reason: "why not, when sent is false: disabled | noConsent | alreadySent | addressLimit" },
  timeoutMs: 30_000,
  async run(config, ctx) {
    const result = await replyToSubmitter(ctx.communityId, config.submissionId.trim(), { subject: config.subject, body: config.body });
    if (!result.sent && result.reason === "notFound") throw new Error("submission not found");
    if (!result.sent) ctx.log("mail not sent", { reason: result.reason });
    return { output: result.sent ? { sent: true, reason: null } : { sent: false, reason: result.reason } };
  },
});
