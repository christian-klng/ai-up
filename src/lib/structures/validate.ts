import { z } from "zod";
import type { ProcessGraph, StructureAnswers, StructureDefinition, StructureElement } from "./types";
import { STRUCTURE_KEY_REGEX, isAnswerable, isMediaLikeAnswer } from "./types";
import { isQaPairArray, pruneHiddenAnswers, visibleElements } from "./visibility";

// ---------------------------------------------------------------------------
// Definition schema
// ---------------------------------------------------------------------------

const showIfSchema = z
  .object({
    key: z.string().regex(STRUCTURE_KEY_REGEX),
    equals: z.union([z.string(), z.boolean()]).optional(),
    includes: z.string().optional(),
    notEmpty: z.boolean().optional(),
  })
  .refine((c) => [c.equals, c.includes, c.notEmpty].filter((v) => v !== undefined).length === 1, {
    message: "showIf needs exactly one of equals, includes, notEmpty",
  });

const base = {
  key: z.string().regex(STRUCTURE_KEY_REGEX, "key must match ^[a-z][a-z0-9_]{0,39}$"),
  label: z.string().trim().min(1).max(200),
  help: z.string().trim().max(1000).optional(),
  required: z.boolean().optional(),
  showIf: showIfSchema.optional(),
};

const optionsSchema = z.array(z.string().trim().min(1).max(200)).min(1).max(50);

const processNodeSchema = z.object({
  id: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  kind: z.enum(["start", "step", "decision", "end"]),
  x: z.number().finite(),
  y: z.number().finite(),
});

const processEdgeSchema = z.object({
  id: z.string().trim().min(1).max(120),
  from: z.string().trim().min(1).max(60),
  to: z.string().trim().min(1).max(60),
  condition: z.string().trim().max(200).optional(),
});

export const processGraphSchema = z.object({
  nodes: z.array(processNodeSchema).max(100),
  edges: z.array(processEdgeSchema).max(200),
});

export const structureElementSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("info"), body: z.string().trim().min(1).max(10000) }),
  z.object({ ...base, type: z.literal("text"), placeholder: z.string().trim().max(200).optional(), maxLength: z.number().int().min(1).max(2000).optional() }),
  z.object({ ...base, type: z.literal("textarea"), placeholder: z.string().trim().max(200).optional(), maxLength: z.number().int().min(1).max(50000).optional() }),
  z.object({ ...base, type: z.literal("select"), options: optionsSchema, placeholder: z.string().trim().max(200).optional() }),
  z.object({ ...base, type: z.literal("chips"), options: optionsSchema, minSelected: z.number().int().min(0).max(50).optional(), maxSelected: z.number().int().min(1).max(50).optional() }),
  z.object({ ...base, type: z.literal("checkbox") }),
  z.object({
    ...base,
    type: z.literal("qa"),
    questionLabel: z.string().trim().max(200).optional(),
    answerLabel: z.string().trim().max(200).optional(),
    minPairs: z.number().int().min(0).max(100).optional(),
    maxPairs: z.number().int().min(1).max(100).optional(),
  }),
  z.object({ ...base, type: z.literal("process"), seed: processGraphSchema }),
  z.object({ ...base, type: z.literal("markdown"), placeholder: z.string().trim().max(200).optional(), maxLength: z.number().int().min(1).max(200000).optional() }),
  z.object({ ...base, type: z.literal("image") }),
  z.object({ ...base, type: z.literal("link") }),
  z.object({ ...base, type: z.literal("video") }),
]);

export const structureDefinitionSchema = z.object({
  formatVersion: z.literal(1),
  intro: z.string().trim().max(5000).optional(),
  elements: z.array(structureElementSchema).min(1).max(100),
});

export type ValidationIssue = { path: string; message: string };
export type StructureValidationResult = {
  def?: StructureDefinition;
  issues: ValidationIssue[];
  warnings: ValidationIssue[];
};

function graphChecks(graph: ProcessGraph, path: string, issues: ValidationIssue[], warnings: ValidationIssue[]): void {
  const ids = new Set<string>();
  graph.nodes.forEach((n, i) => {
    if (ids.has(n.id)) issues.push({ path: `${path}.nodes.${i}`, message: `duplicate node id "${n.id}"` });
    ids.add(n.id);
  });
  graph.edges.forEach((e, i) => {
    if (!ids.has(e.from)) issues.push({ path: `${path}.edges.${i}`, message: `edge references unknown node "${e.from}"` });
    if (!ids.has(e.to)) issues.push({ path: `${path}.edges.${i}`, message: `edge references unknown node "${e.to}"` });
  });
  if (graph.nodes.length === 0) {
    issues.push({ path: `${path}.nodes`, message: "graph needs at least one node" });
    return;
  }
  const starts = graph.nodes.filter((n) => n.kind === "start");
  if (starts.length !== 1) warnings.push({ path: `${path}.nodes`, message: `expected exactly one start node, found ${starts.length}` });
  if (starts.length > 0) {
    const reachable = new Set<string>(starts.map((n) => n.id));
    let grew = true;
    while (grew) {
      grew = false;
      for (const e of graph.edges) {
        if (reachable.has(e.from) && !reachable.has(e.to)) {
          reachable.add(e.to);
          grew = true;
        }
      }
    }
    const unreachable = graph.nodes.filter((n) => !reachable.has(n.id));
    if (unreachable.length > 0) warnings.push({ path: `${path}.nodes`, message: `unreachable node(s): ${unreachable.map((n) => n.label).join(", ")}` });
  }
}

/** showIf operator compatibility per referenced element type. */
function showIfCompatible(target: StructureElement, cond: NonNullable<StructureElement["showIf"]>): string | null {
  if (cond.includes !== undefined && target.type !== "chips") return "includes only works with chips elements";
  if (cond.equals !== undefined) {
    if (typeof cond.equals === "boolean" && target.type !== "checkbox") return "boolean equals only works with checkbox elements";
    if (typeof cond.equals === "string" && !["text", "textarea", "select"].includes(target.type)) return "string equals only works with text, textarea or select elements";
    if (typeof cond.equals === "string" && target.type === "select" && !target.options.includes(cond.equals)) return `"${cond.equals}" is not an option of "${target.key}"`;
  }
  return null;
}

export function validateStructure(input: unknown): StructureValidationResult {
  const issues: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const parsed = structureDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({ path: issue.path.join("."), message: issue.message });
    }
    return { issues, warnings };
  }
  const def = parsed.data as StructureDefinition;

  const seen = new Map<string, StructureElement>();
  def.elements.forEach((el, i) => {
    const path = `elements.${i}`;
    if (seen.has(el.key)) issues.push({ path: `${path}.key`, message: `duplicate key "${el.key}"` });
    if (el.showIf) {
      const target = seen.get(el.showIf.key);
      if (!target) {
        issues.push({ path: `${path}.showIf`, message: `showIf must reference an earlier element (unknown or later key "${el.showIf.key}")` });
      } else if (!isAnswerable(target)) {
        issues.push({ path: `${path}.showIf`, message: `showIf cannot reference an info element ("${el.showIf.key}")` });
      } else {
        const incompat = showIfCompatible(target, el.showIf);
        if (incompat) issues.push({ path: `${path}.showIf`, message: incompat });
      }
    }
    if (el.type === "chips" && el.minSelected !== undefined && el.maxSelected !== undefined && el.minSelected > el.maxSelected) {
      issues.push({ path: `${path}.minSelected`, message: "minSelected must not exceed maxSelected" });
    }
    if (el.type === "qa" && el.minPairs !== undefined && el.maxPairs !== undefined && el.minPairs > el.maxPairs) {
      issues.push({ path: `${path}.minPairs`, message: "minPairs must not exceed maxPairs" });
    }
    if (el.type === "process") graphChecks(el.seed, `${path}.seed`, issues, warnings);
    seen.set(el.key, el);
  });

  return issues.length === 0 ? { def, issues, warnings } : { issues, warnings };
}

// ---------------------------------------------------------------------------
// Answer validation (client + server)
// ---------------------------------------------------------------------------

/** code is translated client-side (knowledge.structured.errors.*) */
export type AnswerIssue = { key: string; code: "required" | "invalid" | "minSelected" | "maxSelected" | "minPairs" | "maxPairs" | "incompletePair" | "urlInvalid" | "mediaInvalid"; count?: number };
export type AnswerValidationResult = { ok: true; answers: StructureAnswers } | { ok: false; issues: AnswerIssue[] };

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validates raw answers against a definition. Hidden elements are pruned and
 * never required. Returns cleaned answers on success.
 */
export function validateStructureAnswers(def: StructureDefinition, raw: unknown): AnswerValidationResult {
  const input = (typeof raw === "object" && raw !== null ? raw : {}) as StructureAnswers;
  const issues: AnswerIssue[] = [];
  const cleaned: StructureAnswers = {};

  for (const el of visibleElements(def, input)) {
    if (!isAnswerable(el)) continue;
    const value = input[el.key];
    const missing = () => {
      if (el.required) issues.push({ key: el.key, code: "required" });
    };
    switch (el.type) {
      case "text":
      case "textarea": {
        if (typeof value !== "string" || !value.trim()) {
          missing();
          break;
        }
        const max = el.maxLength ?? (el.type === "text" ? 2000 : 50000);
        cleaned[el.key] = value.trim().slice(0, max);
        break;
      }
      case "select": {
        if (typeof value !== "string" || !value) {
          missing();
          break;
        }
        if (!el.options.includes(value)) {
          issues.push({ key: el.key, code: "invalid" });
          break;
        }
        cleaned[el.key] = value;
        break;
      }
      case "chips": {
        const arr = Array.isArray(value) ? (value as string[]).filter((v) => typeof v === "string" && el.options.includes(v)) : [];
        const unique = [...new Set(arr)];
        if (unique.length === 0) {
          if (el.required || (el.minSelected ?? 0) > 0) issues.push({ key: el.key, code: "required" });
          break;
        }
        if (el.minSelected !== undefined && unique.length < el.minSelected) {
          issues.push({ key: el.key, code: "minSelected", count: el.minSelected });
          break;
        }
        if (el.maxSelected !== undefined && unique.length > el.maxSelected) {
          issues.push({ key: el.key, code: "maxSelected", count: el.maxSelected });
          break;
        }
        cleaned[el.key] = unique;
        break;
      }
      case "checkbox": {
        if (typeof value !== "boolean") {
          if (el.required) issues.push({ key: el.key, code: "required" });
          else cleaned[el.key] = false;
          break;
        }
        if (el.required && !value) {
          issues.push({ key: el.key, code: "required" });
          break;
        }
        cleaned[el.key] = value;
        break;
      }
      case "qa": {
        const pairs = isQaPairArray(value) ? value.map((p) => ({ question: p.question.trim().slice(0, 1000), answer: p.answer.trim().slice(0, 10000) })).filter((p) => p.question || p.answer) : [];
        const incomplete = pairs.some((p) => !p.question || !p.answer);
        if (incomplete) {
          issues.push({ key: el.key, code: "incompletePair" });
          break;
        }
        if (pairs.length === 0) {
          if (el.required || (el.minPairs ?? 0) > 0) issues.push({ key: el.key, code: "required" });
          break;
        }
        if (el.minPairs !== undefined && pairs.length < el.minPairs) {
          issues.push({ key: el.key, code: "minPairs", count: el.minPairs });
          break;
        }
        if (el.maxPairs !== undefined && pairs.length > el.maxPairs) {
          issues.push({ key: el.key, code: "maxPairs", count: el.maxPairs });
          break;
        }
        cleaned[el.key] = pairs;
        break;
      }
      case "process": {
        const parsed = processGraphSchema.safeParse(value);
        if (!parsed.success) {
          missing();
          break;
        }
        const graphIssues: ValidationIssue[] = [];
        graphChecks(parsed.data, el.key, graphIssues, []);
        if (graphIssues.length > 0) {
          issues.push({ key: el.key, code: "invalid" });
          break;
        }
        cleaned[el.key] = parsed.data;
        break;
      }
      case "markdown": {
        if (typeof value !== "string" || !value.trim()) {
          missing();
          break;
        }
        const max = el.maxLength ?? 200000;
        cleaned[el.key] = value.replace(/\r\n?/g, "\n").trim().slice(0, max);
        break;
      }
      case "image":
      case "video": {
        if (!isMediaLikeAnswer(value) || (!value.mediaId?.trim() && !value.url?.trim())) {
          missing();
          break;
        }
        if (value.mediaId && value.url) {
          issues.push({ key: el.key, code: "invalid" });
          break;
        }
        if (value.url !== undefined && !isHttpUrl(value.url)) {
          issues.push({ key: el.key, code: "urlInvalid" });
          break;
        }
        const alt = el.type === "image" && typeof (value as { alt?: unknown }).alt === "string" ? (value as { alt: string }).alt.trim().slice(0, 500) : undefined;
        cleaned[el.key] = value.mediaId ? { mediaId: value.mediaId.trim(), ...(alt ? { alt } : {}) } : { url: value.url!.trim().slice(0, 2000), ...(alt ? { alt } : {}) };
        break;
      }
      case "link": {
        if (!isMediaLikeAnswer(value) || !value.url?.trim()) {
          missing();
          break;
        }
        if (!isHttpUrl(value.url)) {
          issues.push({ key: el.key, code: "urlInvalid" });
          break;
        }
        cleaned[el.key] = { url: value.url.trim().slice(0, 2000) };
        break;
      }
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, answers: pruneHiddenAnswers(def, cleaned) };
}
