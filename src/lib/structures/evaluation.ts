// Evaluation criteria for content templates: admin-authored qualitative checks
// that an LLM runs against a whole entry after every save. Unlike the structure
// definition these are NOT snapshotted per entry – a criteria change applies to
// every entry of the template right away (see docs/entwicklung.md).
// Pure TS – shared by the admin editor, server actions and the worker.

import { z } from "zod";
import type { ValidationIssue } from "./validate";

export type EvaluationCriterion = {
  /** unique per template, ^[a-z][a-z0-9_]{0,39}$ */
  key: string;
  /** short label shown in the entry popover (1–3 words) */
  title: string;
  /** what the model has to check, in the admin's own words */
  instruction: string;
};

export type TemplateEvaluation = {
  /** llm_providers.id or "default" (admin's default provider) */
  providerId: string;
  /** model id or "default" (provider's default model) */
  model: string;
  criteria: EvaluationCriterion[];
};

export const EVALUATION_KEY_REGEX = /^[a-z][a-z0-9_]{0,39}$/;
export const MAX_CRITERIA = 20;
export const MAX_CRITERION_TITLE = 40;
export const MAX_CRITERION_INSTRUCTION = 2000;

export const evaluationCriterionSchema = z.object({
  key: z.string().regex(EVALUATION_KEY_REGEX, "key must match ^[a-z][a-z0-9_]{0,39}$"),
  title: z.string().trim().min(1).max(MAX_CRITERION_TITLE),
  instruction: z.string().trim().min(1).max(MAX_CRITERION_INSTRUCTION),
});

export const templateEvaluationSchema = z.object({
  providerId: z.string().trim().min(1).max(100).default("default"),
  model: z.string().trim().min(1).max(200).default("default"),
  criteria: z.array(evaluationCriterionSchema).max(MAX_CRITERIA).default([]),
});

export function emptyEvaluation(): TemplateEvaluation {
  return { providerId: "default", model: "default", criteria: [] };
}

/** Parses admin input; duplicate keys are an issue, an empty criteria list simply switches evaluation off. */
export function validateEvaluation(input: unknown): { evaluation?: TemplateEvaluation; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const parsed = templateEvaluationSchema.safeParse(input ?? {});
  if (!parsed.success) {
    for (const issue of parsed.error.issues) issues.push({ path: `evaluation.${issue.path.join(".")}`, message: issue.message });
    return { issues };
  }
  const seen = new Set<string>();
  parsed.data.criteria.forEach((c, i) => {
    if (seen.has(c.key)) issues.push({ path: `evaluation.criteria.${i}.key`, message: `duplicate key "${c.key}"` });
    seen.add(c.key);
  });
  return issues.length === 0 ? { evaluation: parsed.data, issues } : { issues };
}

/** Slugifies a criterion title into a stable key, avoiding the keys already taken. */
export function criterionKeyFromTitle(title: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base =
    title
      .toLowerCase()
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .replace(/^([0-9])/, "c$1")
      .slice(0, 40) || "criterion";
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base.slice(0, 36)}_${n}`;
    if (!used.has(candidate)) return candidate;
  }
}
