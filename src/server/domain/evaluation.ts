import { and, eq, notInArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { contentEvaluations, contentVersions, contents, type ContentEvaluation, type EvaluationStatus } from "@/server/db/schema";
import { getTemplateById } from "@/server/domain/templates";
import { chatCompletion, modelCapabilities } from "@/server/llm/client";
import { clientConfigFor, resolveModel } from "@/server/llm/providers";
import { extractJson } from "@/lib/extract-json";
import { publishBroadcast } from "@/server/realtime/publish";
import { logger } from "@/server/logger";
import type { EvaluationCriterion, TemplateEvaluation } from "@/lib/structures/evaluation";

// ---------------------------------------------------------------------------
// Entry evaluation: after every save an LLM checks the whole entry against the
// qualitative criteria of its template – one call per criterion, because a
// single verdict over all of them blurs the reasons. Runs in the worker
// (see worker/index.ts); this module must stay free of next/* imports.
// ---------------------------------------------------------------------------

/** Entry markdown is capped so a huge entry cannot blow up the prompt (and the bill). */
const MAX_ENTRY_CHARS = 20_000;
const CRITERION_TIMEOUT_MS = 60_000;
/** Criteria per entry that run at the same time. */
const CONCURRENCY = 3;

export type EvaluationSummary = {
  rows: ContentEvaluation[];
  /** template has criteria but this version has no verdicts yet (job still queued/running) */
  pending: boolean;
  criteriaCount: number;
  passed: number;
  failed: number;
  errored: number;
};

export async function listEvaluations(versionId: string): Promise<ContentEvaluation[]> {
  return db.query.contentEvaluations.findMany({ where: eq(contentEvaluations.versionId, versionId) });
}

/** Verdicts for the entry's current version plus the "still running" hint for the UI. */
export async function getEvaluationSummary(contentId: string, versionId: string | null, templateId: string | null): Promise<EvaluationSummary | null> {
  if (!templateId || !versionId) return null;
  const template = await getTemplateById(templateId);
  const criteriaCount = template?.evaluation.criteria.length ?? 0;
  if (criteriaCount === 0) return null;
  const rows = await listEvaluations(versionId);
  return {
    rows,
    pending: rows.length === 0,
    criteriaCount,
    passed: rows.filter((r) => r.status === "pass").length,
    failed: rows.filter((r) => r.status === "fail").length,
    errored: rows.filter((r) => r.status === "error").length,
  };
}

/** Entry ids whose current version was filled from this template (for "re-check all"). */
export async function listContentIdsForTemplate(templateId: string): Promise<{ contentId: string; versionId: string }[]> {
  const rows = await db
    .select({ contentId: contents.id, versionId: contentVersions.id, meta: contentVersions.meta })
    .from(contents)
    .innerJoin(contentVersions, eq(contentVersions.id, contents.currentVersionId))
    .where(eq(contents.type, "structured"));
  return rows.filter((r) => r.meta.structure?.structureId === templateId).map((r) => ({ contentId: r.contentId, versionId: r.versionId }));
}

type CriterionVerdict = { status: EvaluationStatus; reason: string | null; usage?: ContentEvaluation["usage"] };

const SYSTEM_PROMPT = [
  "You are a meticulous editorial reviewer for a community knowledge base.",
  "You check one single criterion against a complete entry and answer strictly in JSON.",
  'Answer with {"passed": boolean, "reason": string}.',
  "`passed` is true only when the entry clearly meets the criterion; when in doubt, answer false.",
  "`reason` is one short sentence (max 200 characters) written in the language of the criterion, naming the concrete evidence in the entry.",
  "Judge only the criterion given – never style, length or topics it does not mention.",
].join(" ");

const VERDICT_SCHEMA = {
  type: "object",
  properties: { passed: { type: "boolean" }, reason: { type: "string" } },
  required: ["passed", "reason"],
  additionalProperties: false,
} as const;

function userPrompt(criterion: EvaluationCriterion, title: string, body: string): string {
  return [
    `Criterion "${criterion.title}":`,
    criterion.instruction,
    "",
    "--- ENTRY START ---",
    `# ${title}`,
    "",
    body,
    "--- ENTRY END ---",
    "",
    "Does the entry meet the criterion?",
  ].join("\n");
}

/** Runs one criterion; provider/model errors become an "error" verdict instead of failing the batch. */
async function judge(criterion: EvaluationCriterion, title: string, body: string, evaluation: TemplateEvaluation): Promise<CriterionVerdict> {
  try {
    const { provider, model, info } = await resolveModel(evaluation.providerId, evaluation.model);
    const caps = modelCapabilities(info, provider.kind);
    const cfg = await clientConfigFor(provider);
    const res = await chatCompletion(cfg, {
      model,
      messages: [
        { role: "system", content: caps.structuredOutputs ? SYSTEM_PROMPT : `${SYSTEM_PROMPT} Respond with a single valid JSON document only – no prose, no markdown fences.` },
        { role: "user", content: userPrompt(criterion, title, body) },
      ],
      ...(caps.structuredOutputs ? { jsonSchema: VERDICT_SCHEMA as unknown as Record<string, unknown> } : {}),
      ...(caps.temperature ? { temperature: 0 } : {}),
      maxTokens: 500,
      timeoutMs: CRITERION_TIMEOUT_MS,
    });
    const parsed = extractJson(res.text) as { passed?: unknown; reason?: unknown } | undefined;
    if (!parsed || typeof parsed.passed !== "boolean") {
      return { status: "error", reason: `Model returned no usable verdict: ${res.text.slice(0, 200)}`, usage: res.usage };
    }
    const reason = typeof parsed.reason === "string" ? parsed.reason.trim().slice(0, 1000) : null;
    return { status: parsed.passed ? "pass" : "fail", reason, usage: res.usage };
  } catch (err) {
    return { status: "error", reason: (err as Error).message.slice(0, 1000) };
  }
}

async function runPooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) results[i] = await fn(items[i]);
  });
  await Promise.all(workers);
  return results;
}

export type EvaluationRunResult = { ok: true; evaluated: number } | { ok: false; reason: "notFound" | "stale" | "unstructured" | "noCriteria" };

/**
 * Checks one entry version against its template criteria and stores a verdict per criterion.
 * Jobs for outdated versions are dropped – only the current version is worth the tokens.
 */
export async function evaluateContentVersion(contentId: string, versionId: string): Promise<EvaluationRunResult> {
  const content = await db.query.contents.findFirst({ where: eq(contents.id, contentId) });
  if (!content || content.deletedAt) return { ok: false, reason: "notFound" };
  if (content.currentVersionId !== versionId) return { ok: false, reason: "stale" };
  const version = await db.query.contentVersions.findFirst({ where: eq(contentVersions.id, versionId) });
  if (!version) return { ok: false, reason: "notFound" };

  const snapshot = version.meta.structure;
  if (content.type !== "structured" || !snapshot) return { ok: false, reason: "unstructured" };
  const template = await getTemplateById(snapshot.structureId);
  const criteria = template?.evaluation.criteria ?? [];
  if (!template || criteria.length === 0) {
    await db.delete(contentEvaluations).where(eq(contentEvaluations.versionId, versionId));
    return { ok: false, reason: "noCriteria" };
  }

  const body = (version.bodyMarkdown ?? "").slice(0, MAX_ENTRY_CHARS);
  const verdicts = await runPooled(criteria, CONCURRENCY, (c) => judge(c, version.title, body, template.evaluation));
  const providerId = template.evaluation.providerId !== "default" ? template.evaluation.providerId : null;

  await db.transaction(async (tx) => {
    await tx.delete(contentEvaluations).where(and(eq(contentEvaluations.versionId, versionId), notInArray(contentEvaluations.criterionKey, criteria.map((c) => c.key))));
    for (const [i, criterion] of criteria.entries()) {
      const verdict = verdicts[i];
      const values = {
        contentId,
        versionId,
        templateId: template.id,
        criterionKey: criterion.key,
        criterionTitle: criterion.title,
        criterionInstruction: criterion.instruction,
        status: verdict.status,
        reason: verdict.reason,
        providerId,
        model: template.evaluation.model !== "default" ? template.evaluation.model : null,
        usage: verdict.usage ?? null,
        createdAt: new Date(),
      };
      await tx
        .insert(contentEvaluations)
        .values(values)
        .onConflictDoUpdate({ target: [contentEvaluations.versionId, contentEvaluations.criterionKey], set: values });
    }
  });

  const failed = verdicts.filter((v) => v.status === "fail").length;
  const errored = verdicts.filter((v) => v.status === "error").length;
  logger.info({ contentId, versionId, criteria: criteria.length, failed, errored }, "entry evaluated");
  await publishBroadcast("content.evaluation.updated", {
    contentId,
    versionId,
    passed: verdicts.length - failed - errored,
    failed,
    errored,
    total: criteria.length,
  });
  return { ok: true, evaluated: criteria.length };
}

/** Drops verdicts of entries that are no longer covered (criterion removed from the template). */
export async function deleteEvaluationsForTemplate(templateId: string, keepKeys: string[]): Promise<void> {
  if (keepKeys.length === 0) {
    await db.delete(contentEvaluations).where(eq(contentEvaluations.templateId, templateId));
    return;
  }
  await db.delete(contentEvaluations).where(and(eq(contentEvaluations.templateId, templateId), notInArray(contentEvaluations.criterionKey, keepKeys)));
}
