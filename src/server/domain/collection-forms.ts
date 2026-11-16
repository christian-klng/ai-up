import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLog, collectionForms, communities, contentTemplates, formSubmissions, knowledgeAreas, mediaFiles, type CollectionForm, type Community, type ContentTemplate, type FormSubmission, type KnowledgeArea } from "@/server/db/schema";
import { env } from "@/server/env";
import { logger } from "@/server/logger";
import { getRedis } from "@/server/redis";
import { deleteStoredFile } from "@/server/media/storage";
import {
  DEFAULT_FORM_SUCCESS,
  DEFAULT_FORM_TEXTS,
  FORM_DAILY_LIMIT_DEFAULT,
  FORM_MAX_IMAGES,
  FORM_MIN_FILL_MS,
  FORM_STAMP_TTL_MS,
  formImageKeys,
  formProblems,
  publicDefinition,
  type FormProblem,
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
  | { ok: true; submissionId: string | null; key: string | null; success: FormSuccess }
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
  if (input.website) return { ok: true, submissionId: null, key: null, success };

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

  const content = await createContent(community.id, area.id, "structured", built.input, null, { kind: "external", formId: form.id, submissionId });
  const key = randomBytes(24).toString("base64url");
  await db.insert(formSubmissions).values({
    id: submissionId,
    communityId: community.id,
    formId: form.id,
    contentId: content.id,
    accessKeyHash: createHash("sha256").update(key).digest("hex"),
    contactName: form.contact === "off" ? null : name,
    contactEmail: form.contact === "off" ? null : email,
    pageUrl: safePageUrl(input.pageUrl),
  });
  // From here on the images are ordinary content: the sweep below leaves them alone, and a second
  // submission cannot attach them again.
  if (mediaIds.length) await db.update(mediaFiles).set({ purpose: "content" }).where(inArray(mediaFiles.id, mediaIds));
  await db
    .update(collectionForms)
    .set({ submissionCount: sql`${collectionForms.submissionCount} + 1` })
    .where(eq(collectionForms.id, form.id));
  logger.info({ formId: form.id, contentId: content.id, submissionId }, "form submission stored");
  return { ok: true, submissionId, key, success };
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
