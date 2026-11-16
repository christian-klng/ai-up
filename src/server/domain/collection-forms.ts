import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { emitDomainEvent } from "@/server/events/bus";
import { sendMail } from "@/server/mail/mailer";
import { mailContext, submissionReplyMail } from "@/server/mail/templates";
import { db } from "@/server/db/client";
import { auditLog, collectionForms, communities, contentTemplates, formSubmissions, knowledgeAreas, mediaFiles, workflows, type CollectionForm, type Community, type ContentTemplate, type FormSubmission, type KnowledgeArea } from "@/server/db/schema";
import { env } from "@/server/env";
import { logger } from "@/server/logger";
import { getRedis } from "@/server/redis";
import { deleteStoredFile } from "@/server/media/storage";
import {
  DEFAULT_FORM_SUCCESS,
  DEFAULT_FORM_TEXTS,
  FORM_DAILY_LIMIT_DEFAULT,
  FORM_MAILS_PER_ADDRESS_PER_DAY,
  FORM_MAX_IMAGES,
  FORM_RESPONSE_BODY_MAX,
  FORM_RESPONSE_TITLE_MAX,
  FORM_SUCCESS_STYLES,
  FORM_MIN_FILL_MS,
  FORM_STAMP_TTL_MS,
  formImageKeys,
  formProblems,
  publicDefinition,
  type FormProblem,
  type FormResponse,
  type FormSettings,
  type FormSubmissionInput,
  type FormSubmitError,
  type FormSuccess,
} from "@/lib/collection-forms";
import type { StructureAnswers, StructureDefinition } from "@/lib/structures/types";
import { isMediaLikeAnswer } from "@/lib/structures/types";
import type { AnswerIssue } from "@/lib/structures/validate";
import { communityUrl } from "./communities";
import { createContent, getAreaById } from "./knowledge";
import { buildStructuredVersionInput } from "./structured-entries";
import { isTemplateAvailableForArea, listAvailableTemplates } from "./templates";

/**
 * External channel of a collection (docs/externe-formulare.md): one template published as a form
 * at /f/<token>. Same shape as the invite links – random token, off by default, stable across
 * toggles – but what comes in is an entry without an author, written by someone we know nothing
 * about. Everything an anonymous sender can reach goes through this file.
 */

export function formPath(token: string): string {
  return `/f/${token}`;
}

export type CollectionFormView = {
  /** null until the form was saved for the first time */
  form: CollectionForm | null;
  /** absolute address of the public page; null until the form exists */
  url: string | null;
  settings: FormSettings;
  /** templates the collection offers – the form is one of them */
  templates: Pick<ContentTemplate, "id" | "name" | "icon" | "definition">[];
};

function settingsOf(form: CollectionForm | null): FormSettings {
  return {
    enabled: form?.enabled ?? false,
    templateId: form?.templateId ?? null,
    fieldKeys: form?.fieldKeys ?? [],
    texts: { ...DEFAULT_FORM_TEXTS, ...form?.texts },
    contact: form?.contact ?? "off",
    success: { ...DEFAULT_FORM_SUCCESS, ...form?.success },
    mailReply: form?.mailReply ?? false,
    dailyLimit: form?.dailyLimit ?? FORM_DAILY_LIMIT_DEFAULT,
  };
}

/** The form of a collection as the admin dialog needs it. `undefined` when the collection is not in this community. */
export async function getCollectionForm(communityId: string, areaId: string): Promise<CollectionFormView | undefined> {
  const area = await getAreaById(communityId, areaId);
  if (!area) return undefined;
  const [form, templates, community] = await Promise.all([
    db.query.collectionForms.findFirst({ where: eq(collectionForms.areaId, area.id) }),
    listAvailableTemplates(area.id),
    db.query.communities.findFirst({ where: eq(communities.id, communityId) }),
  ]);
  return {
    form: form ?? null,
    url: form && community ? await communityUrl(community, formPath(form.token)) : null,
    settings: settingsOf(form ?? null),
    templates: templates.map((t) => ({ id: t.id, name: t.name, icon: t.icon, definition: t.definition })),
  };
}

export type SaveFormResult = { ok: true; form: CollectionForm; url: string } | { ok: false; reason: "notFound" | "template" | FormProblem };

/**
 * Saves the form's settings; the row (and with it the address) is created on the first save.
 * Switching it on is refused while there is nothing an outsider could fill in.
 */
export async function saveCollectionForm(communityId: string, areaId: string, settings: FormSettings, actorId: string): Promise<SaveFormResult> {
  const area = await getAreaById(communityId, areaId);
  const community = await db.query.communities.findFirst({ where: eq(communities.id, communityId) });
  if (!area || !community) return { ok: false, reason: "notFound" };

  let definition: StructureDefinition | null = null;
  if (settings.templateId) {
    if (!(await isTemplateAvailableForArea(area.id, settings.templateId))) return { ok: false, reason: "template" };
    const template = await db.query.contentTemplates.findFirst({ where: eq(contentTemplates.id, settings.templateId) });
    definition = template?.definition ?? null;
  }
  // Only keys the form can actually show are stored – a stale or made-up key is dropped here.
  const fieldKeys = definition ? publicDefinition(definition, settings.fieldKeys).elements.map((el) => el.key) : [];
  if (settings.enabled) {
    const problems = formProblems(definition, fieldKeys);
    if (problems.length) return { ok: false, reason: problems[0] };
  }

  const existing = await db.query.collectionForms.findFirst({ where: eq(collectionForms.areaId, area.id) });
  const values = {
    enabled: settings.enabled,
    templateId: settings.templateId,
    fieldKeys,
    texts: settings.texts,
    contact: settings.contact,
    success: settings.success,
    // Without an address to write to there is nothing to allow.
    mailReply: settings.mailReply && settings.contact !== "off",
    dailyLimit: settings.dailyLimit,
    ...(settings.enabled && !existing?.enabled ? { enabledBy: actorId } : {}),
  };
  const [form] = existing
    ? await db.update(collectionForms).set(values).where(eq(collectionForms.id, existing.id)).returning()
    : await db
        .insert(collectionForms)
        .values({ ...values, communityId, areaId: area.id, token: randomBytes(24).toString("base64url") })
        .returning();
  if ((existing?.enabled ?? false) !== form.enabled) {
    await db.insert(auditLog).values({ communityId, actorId, action: form.enabled ? "collection.form.enabled" : "collection.form.disabled", targetType: "collection_form", targetId: form.id, details: { areaId: area.id } });
  }
  return { ok: true, form, url: await communityUrl(community, formPath(form.token)) };
}

/** areaId → is the external channel open? For the badges in the admin list. */
export async function listOpenFormAreaIds(communityId: string): Promise<Set<string>> {
  const rows = await db.select({ areaId: collectionForms.areaId }).from(collectionForms).where(and(eq(collectionForms.communityId, communityId), eq(collectionForms.enabled, true)));
  return new Set(rows.map((r) => r.areaId));
}

export type ResolvedForm = {
  form: CollectionForm;
  area: KnowledgeArea;
  community: Community;
  template: ContentTemplate;
  /** the fields an outsider sees and may answer */
  definition: StructureDefinition;
};

/** The form behind a token, when it is open: switched on, community alive, template still offered, something to fill in. */
export async function resolveForm(token: string): Promise<ResolvedForm | null> {
  if (!token || token.length > 64) return null;
  const [row] = await db
    .select({ form: collectionForms, area: knowledgeAreas, community: communities, template: contentTemplates })
    .from(collectionForms)
    .innerJoin(knowledgeAreas, eq(knowledgeAreas.id, collectionForms.areaId))
    .innerJoin(communities, eq(communities.id, collectionForms.communityId))
    .innerJoin(contentTemplates, eq(contentTemplates.id, collectionForms.templateId))
    .where(and(eq(collectionForms.token, token), eq(collectionForms.enabled, true), isNull(communities.deletedAt)))
    .limit(1);
  if (!row) return null;
  // The collection's template choice may have changed since the form was set up.
  if (!(await isTemplateAvailableForArea(row.area.id, row.template.id))) return null;
  if (formProblems(row.template.definition, row.form.fieldKeys).length) return null;
  return { ...row, definition: publicDefinition(row.template.definition, row.form.fieldKeys) };
}

// ---------------------------------------------------------------------------
// Signed values handed to the anonymous browser
// ---------------------------------------------------------------------------

function sign(payload: string): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET).update(`form:${payload}`).digest("base64url");
}

function sameSignature(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Render time of a form, signed – the submission proves with it how long filling in took. */
export function issueFormStamp(formId: string, now = Date.now()): string {
  return `${now}.${sign(`stamp:${formId}:${now}`)}`;
}

/** Milliseconds since the stamp was issued; null when it is not ours. */
export function formStampAge(formId: string, stamp: string, now = Date.now()): number | null {
  const [ts, sig] = stamp.split(".");
  if (!ts || !sig || !/^\d{1,16}$/.test(ts) || !sameSignature(sig, sign(`stamp:${formId}:${ts}`))) return null;
  return now - Number(ts);
}

/** Proof that an upload was made through this form – without it a submission cannot attach the file. */
export function issueUploadTicket(formId: string, mediaId: string): string {
  return sign(`upload:${formId}:${mediaId}`);
}

function isUploadTicket(formId: string, mediaId: string, ticket: string | undefined): boolean {
  return Boolean(ticket) && sameSignature(ticket!, issueUploadTicket(formId, mediaId));
}

// ---------------------------------------------------------------------------
// Limits (Redis counters; keys are hashed so no address sits readable for the window)
// ---------------------------------------------------------------------------

async function withinLimit(scope: string, value: string, max: number, windowSeconds: number): Promise<boolean> {
  const key = `aiup:form-limit:${scope}:${createHash("sha256").update(value).digest("hex")}`;
  const redis = getRedis();
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSeconds);
  return count <= max;
}

const SUBMIT_LIMIT = { max: 5, windowSeconds: 10 * 60 };
const UPLOAD_LIMIT = { max: 10, windowSeconds: 10 * 60 };

/** Uploads one address may make through one form (counts the attempt). */
export function withinFormUploadLimit(formId: string, ip: string): Promise<boolean> {
  return withinLimit("upload", `${formId}:${ip}`, UPLOAD_LIMIT.max, UPLOAD_LIMIT.windowSeconds);
}

function withinDailyLimit(form: CollectionForm): Promise<boolean> {
  return withinLimit("day", `${form.id}:${new Date().toISOString().slice(0, 10)}`, form.dailyLimit, 26 * 60 * 60);
}

// ---------------------------------------------------------------------------
// Submitting
// ---------------------------------------------------------------------------

export type SubmitFormResult =
  | { ok: true; submissionId: string | null; key: string | null; success: FormSuccess; /** a workflow is about to answer: ask for it for this many seconds */ waitSeconds: number | null }
  | { ok: false; code: FormSubmitError; issues?: AnswerIssue[] };

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Turns a submission into an entry of the collection: no author, origin `external`, contact details
 * kept apart in form_submissions. The checks run cheapest first, and nothing is written before all
 * of them passed.
 */
export async function submitForm(resolved: ResolvedForm, input: FormSubmissionInput, ctx: { ip: string }): Promise<SubmitFormResult> {
  const { form, area, community, template, definition } = resolved;
  const success: FormSuccess = { ...DEFAULT_FORM_SUCCESS, ...form.success };

  // The honeypot gets the usual answer – whatever filled it in learns nothing from it.
  if (input.website) return { ok: true, submissionId: null, key: null, success, waitSeconds: null };

  const age = formStampAge(form.id, input.stamp);
  if (age === null || age > FORM_STAMP_TTL_MS) return { ok: false, code: "expired" };
  if (age < FORM_MIN_FILL_MS) return { ok: false, code: "tooFast" };

  const name = input.contact?.name?.trim() || null;
  const email = input.contact?.email?.trim() || null;
  if (form.contact !== "off") {
    if (email && !emailRe.test(email)) return { ok: false, code: "contact" };
    if (form.contact === "required" && (!name || !email)) return { ok: false, code: "contact" };
  }

  if (!(await withinLimit("submit", `${form.id}:${ctx.ip}`, SUBMIT_LIMIT.max, SUBMIT_LIMIT.windowSeconds))) return { ok: false, code: "rateLimited" };

  // Uploaded images: only into the form's image fields, only files uploaded through this form and
  // not yet attached anywhere. A plain URL is not accepted from outside – members' browsers would fetch it.
  const answers: StructureAnswers = { ...(input.answers as StructureAnswers) };
  const imageKeys = new Set(formImageKeys(definition));
  const mediaIds: string[] = [];
  for (const key of imageKeys) {
    const value = answers[key];
    if (value === undefined) continue;
    if (!isMediaLikeAnswer(value) || value.url || !value.mediaId) return { ok: false, code: "invalid", issues: [{ key, code: "mediaInvalid" }] };
    if (!isUploadTicket(form.id, value.mediaId, input.uploads?.[value.mediaId])) return { ok: false, code: "invalid", issues: [{ key, code: "mediaInvalid" }] };
    mediaIds.push(value.mediaId);
  }
  if (mediaIds.length > FORM_MAX_IMAGES) return { ok: false, code: "invalid" };
  if (mediaIds.length) {
    const rows = await db
      .select({ id: mediaFiles.id })
      .from(mediaFiles)
      .where(and(inArray(mediaFiles.id, mediaIds), eq(mediaFiles.purpose, "form"), eq(mediaFiles.communityId, community.id)));
    if (rows.length !== new Set(mediaIds).size) return { ok: false, code: "invalid" };
  }

  const submissionId = randomUUID();
  const built = await buildStructuredVersionInput({ structureId: template.id, structureVersion: template.version, definition: template.definition }, input.title, answers, {
    validateAs: definition,
    skipLinkPreviews: true,
  });
  if (!built.ok) return { ok: false, code: "invalid", issues: built.issues };

  // Counted last, so that only submissions that would be accepted use up the day's allowance.
  if (!(await withinDailyLimit(form))) return { ok: false, code: "rateLimited" };

  const contact = form.contact !== "off" && (name || email) ? { name, email } : null;
  // Consent only counts where the form offers the checkbox and there is an address to answer to.
  const mailConsent = Boolean(form.mailReply && input.mailConsent && contact?.email);
  const pageUrl = safePageUrl(input.pageUrl);
  const origin = { kind: "external" as const, formId: form.id, submissionId };
  const content = await createContent(community.id, area.id, "structured", built.input, null, origin);
  const key = randomBytes(24).toString("base64url");
  await db.insert(formSubmissions).values({
    id: submissionId,
    communityId: community.id,
    formId: form.id,
    contentId: content.id,
    accessKeyHash: createHash("sha256").update(key).digest("hex"),
    contactName: contact?.name ?? null,
    contactEmail: contact?.email ?? null,
    mailConsent,
    pageUrl,
  });
  // From here on the images are ordinary content: the sweep below leaves them alone, and a second
  // submission cannot attach them again.
  if (mediaIds.length) await db.update(mediaFiles).set({ purpose: "content" }).where(inArray(mediaFiles.id, mediaIds));
  await db
    .update(collectionForms)
    .set({ submissionCount: sql`${collectionForms.submissionCount} + 1` })
    .where(eq(collectionForms.id, form.id));
  logger.info({ formId: form.id, contentId: content.id, submissionId }, "form submission stored");

  // Only now – the submission row exists, so a workflow can answer it right away.
  const stored = built.input.meta?.structure?.answers ?? {};
  emitDomainEvent("form.submitted", community.id, {
    content: {
      id: content.id,
      type: content.type,
      title: content.title,
      url: null,
      body: built.input.bodyMarkdown ?? null,
      areaId: area.id,
      areaSlug: area.slug,
      areaName: area.name,
      areaPurpose: area.purpose,
      authorId: null,
      authorName: null,
      versionNo: 1,
      href: `/knowledge/${area.slug}/${content.id}`,
    },
    // What the sender filled in – not the seeds of boards the form never showed.
    submission: { id: submissionId, answers: Object.fromEntries(definition.elements.filter((el) => stored[el.key] !== undefined).map((el) => [el.key, stored[el.key]])), contact, mailConsent, pageUrl },
    form: { id: form.id },
    actorId: null,
    origin,
  });
  const waits = success.waitForWorkflow && (await hasFormWorkflow(community.id, area.id));
  return { ok: true, submissionId, key, success, waitSeconds: waits ? success.waitSeconds : null };
}

function safePageUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    // Without query and fragment: they may carry things the embedding site never meant to share.
    return url.protocol === "https:" || url.protocol === "http:" ? `${url.origin}${url.pathname}`.slice(0, 500) : null;
  } catch {
    return null;
  }
}

/** Is there an active workflow that could answer a submission to this collection? Waiting without one would only delay the message. */
async function hasFormWorkflow(communityId: string, areaId: string): Promise<boolean> {
  const active = await db.query.workflows.findMany({ where: and(eq(workflows.communityId, communityId), eq(workflows.status, "active")), columns: { trigger: true } });
  return active.some((w) => {
    if (w.trigger.type !== "form.submitted") return false;
    const areaIds = (w.trigger.config as { areaIds?: unknown }).areaIds;
    return !Array.isArray(areaIds) || areaIds.length === 0 || areaIds.includes(areaId);
  });
}

// ---------------------------------------------------------------------------
// Answering a submission (workflow actions, docs/externe-formulare.md 5 and 6)
// ---------------------------------------------------------------------------

/** Stores the message a workflow wrote for the sender. `false` when the submission is not in this community. */
export async function setSubmissionResponse(communityId: string, submissionId: string, response: { style?: string | null; title: string; body: string }): Promise<boolean> {
  const style = FORM_SUCCESS_STYLES.find((s) => s === response.style) ?? null;
  const value: FormResponse = { style, title: response.title.trim().slice(0, FORM_RESPONSE_TITLE_MAX), body: response.body.trim().slice(0, FORM_RESPONSE_BODY_MAX) };
  const rows = await db
    .update(formSubmissions)
    .set({ response: value })
    .where(and(eq(formSubmissions.id, submissionId), eq(formSubmissions.communityId, communityId)))
    .returning({ id: formSubmissions.id });
  return rows.length > 0;
}

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What the sender's browser polls for. Needs the form's token, the submission id and the key that
 * only the sender got back – `null` (answered as "not found") whenever one of them does not fit.
 */
export async function getSubmissionResponse(token: string, submissionId: string, key: string): Promise<{ response: FormResponse | null } | null> {
  if (!token || token.length > 64 || !uuidRe.test(submissionId) || !key || key.length > 100) return null;
  const [row] = await db
    .select({ hash: formSubmissions.accessKeyHash, response: formSubmissions.response })
    .from(formSubmissions)
    .innerJoin(collectionForms, eq(collectionForms.id, formSubmissions.formId))
    .where(and(eq(formSubmissions.id, submissionId), eq(collectionForms.token, token)))
    .limit(1);
  if (!row || !sameSignature(row.hash, createHash("sha256").update(key).digest("hex"))) return null;
  return { response: row.response ?? null };
}

export type ReplyResult = { sent: true } | { sent: false; reason: "notFound" | "disabled" | "noConsent" | "alreadySent" | "addressLimit" };

/**
 * Mails the sender of a submission – the only mail the app sends to an address nobody confirmed.
 * Hence the fences: the form must allow it, the sender must have asked for it, one mail per
 * submission, a daily cap per address across all forms, and no recipient other than the one stored
 * with the submission. What remains: someone can enter a stranger's address, and a workflow that
 * echoes the input then carries their text to that stranger (docs/externe-formulare.md 6).
 */
export async function replyToSubmitter(communityId: string, submissionId: string, mail: { subject: string; body: string }): Promise<ReplyResult> {
  if (!uuidRe.test(submissionId)) return { sent: false, reason: "notFound" };
  const [row] = await db
    .select({ submission: formSubmissions, form: collectionForms, area: knowledgeAreas, community: communities })
    .from(formSubmissions)
    .innerJoin(collectionForms, eq(collectionForms.id, formSubmissions.formId))
    .innerJoin(knowledgeAreas, eq(knowledgeAreas.id, collectionForms.areaId))
    .innerJoin(communities, eq(communities.id, formSubmissions.communityId))
    .where(and(eq(formSubmissions.id, submissionId), eq(formSubmissions.communityId, communityId)))
    .limit(1);
  if (!row) return { sent: false, reason: "notFound" };
  const { submission, form, area, community } = row;
  if (!form.mailReply) return { sent: false, reason: "disabled" };
  if (!submission.mailConsent || !submission.contactEmail) return { sent: false, reason: "noConsent" };
  if (submission.mailSentAt) return { sent: false, reason: "alreadySent" };
  if (!(await withinLimit("mail", submission.contactEmail, FORM_MAILS_PER_ADDRESS_PER_DAY, 24 * 60 * 60))) return { sent: false, reason: "addressLimit" };

  // Claimed before sending: two runs answering the same submission must not both get through.
  const claimed = await db
    .update(formSubmissions)
    .set({ mailSentAt: new Date() })
    .where(and(eq(formSubmissions.id, submission.id), isNull(formSubmissions.mailSentAt)))
    .returning({ id: formSubmissions.id });
  if (!claimed.length) return { sent: false, reason: "alreadySent" };
  try {
    await sendMail(submissionReplyMail(mailContext(community, community.defaultLocale), submission.contactEmail, { subject: mail.subject, body: mail.body, formTitle: form.texts?.title || area.name }));
  } catch (err) {
    // Not delivered: give the one mail back.
    await db.update(formSubmissions).set({ mailSentAt: null }).where(eq(formSubmissions.id, submission.id));
    throw err;
  }
  return { sent: true };
}

/** The submission an entry came from – contact details for admins. `undefined` for entries written by members. */
export async function getSubmissionForContent(communityId: string, contentId: string): Promise<FormSubmission | undefined> {
  return db.query.formSubmissions.findFirst({ where: and(eq(formSubmissions.contentId, contentId), eq(formSubmissions.communityId, communityId)) });
}

/** Uploads made through a form that never became part of a submission are removed after this long. */
export const FORM_UPLOAD_ORPHAN_HOURS = 24;

/** Daily sweep (worker): deletes form uploads nobody submitted – rows and files. */
export async function cleanupOrphanFormUploads(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - FORM_UPLOAD_ORPHAN_HOURS * 60 * 60 * 1000);
  const rows = await db.query.mediaFiles.findMany({ where: and(eq(mediaFiles.purpose, "form"), lt(mediaFiles.createdAt, cutoff)), limit: 500 });
  for (const media of rows) {
    await db.delete(mediaFiles).where(eq(mediaFiles.id, media.id));
    await deleteStoredFile(media).catch((err) => logger.warn({ err, mediaId: media.id }, "form upload: file could not be removed"));
  }
  return rows.length;
}
