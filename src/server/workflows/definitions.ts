import { z } from "zod";
import type { WorkflowDefinition } from "@/server/db/schema";
import { getAction, getTrigger, listActions, listTriggers } from "./registry";
import { extractVariables } from "./templates";

/**
 * Validation of full workflow definitions (UI + MCP). Trigger/action configs are validated with the
 * registered zod schemas; template variables are checked for obviously wrong step references.
 */
export type ValidationIssue = { path: string; message: string };
export type ValidationResult = { ok: true; definition: WorkflowDefinition; warnings: ValidationIssue[] } | { ok: false; issues: ValidationIssue[]; warnings: ValidationIssue[] };

const stepIdRe = /^[a-z][a-z0-9_]{0,39}$/;

const baseSchema = z.object({
  name: z.string().trim().min(2, "name must have at least 2 characters").max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  trigger: z.object({ type: z.string().min(1), config: z.record(z.string(), z.unknown()).default({}) }),
  steps: z
    .array(
      z.object({
        id: z.string().regex(stepIdRe, "step id: lowercase letters, digits, underscores; must start with a letter"),
        name: z.string().trim().max(120).optional(),
        action: z.string().min(1),
        config: z.record(z.string(), z.unknown()).default({}),
        condition: z.string().max(2000).optional(),
        onError: z.enum(["stop", "continue"]).optional(),
      }),
    )
    .min(1, "a workflow needs at least one step")
    .max(30),
});

function zodIssues(prefix: string, err: z.ZodError): ValidationIssue[] {
  return err.issues.map((i) => ({ path: [prefix, ...i.path.map(String)].filter(Boolean).join("."), message: i.message }));
}

export function validateDefinition(input: unknown): ValidationResult {
  const warnings: ValidationIssue[] = [];
  const base = baseSchema.safeParse(input);
  if (!base.success) return { ok: false, issues: zodIssues("", base.error), warnings };
  const d = base.data;
  const issues: ValidationIssue[] = [];

  const trigger = getTrigger(d.trigger.type);
  let triggerConfig = d.trigger.config;
  if (!trigger) issues.push({ path: "trigger.type", message: `unknown trigger type "${d.trigger.type}". Known: ${listTriggers().map((t) => t.type).join(", ")}` });
  else {
    const parsed = trigger.configSchema.safeParse(d.trigger.config);
    if (!parsed.success) issues.push(...zodIssues("trigger.config", parsed.error));
    else triggerConfig = parsed.data as Record<string, unknown>;
  }

  const seen = new Set<string>();
  const steps = d.steps.map((s, idx) => {
    if (seen.has(s.id)) issues.push({ path: `steps[${idx}].id`, message: `duplicate step id "${s.id}"` });
    seen.add(s.id);
    const action = getAction(s.action);
    let config = s.config;
    if (!action) issues.push({ path: `steps[${idx}].action`, message: `unknown action "${s.action}". Known: ${listActions().map((a) => a.type).join(", ")}` });
    else {
      // Templates are validated after rendering at run time; here we validate the static shape with
      // template placeholders allowed in string fields (schema failures on templated strings are warnings only).
      const parsed = action.configSchema.safeParse(s.config);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const key = String(issue.path[0] ?? "");
          const value = (s.config as Record<string, unknown>)[key];
          const templated = typeof value === "string" && /\{\{|\{%/.test(value);
          const target = templated ? warnings : issues;
          target.push({ path: `steps[${idx}].config.${issue.path.join(".")}`, message: issue.message });
        }
      } else config = parsed.data as Record<string, unknown>;
    }
    // Reference check: {{ steps.foo... }} must point to an earlier step
    const earlier = new Set(d.steps.slice(0, idx).map((x) => x.id));
    for (const [k, v] of Object.entries(s.config)) {
      if (typeof v !== "string") continue;
      for (const ref of extractVariables(v)) {
        const m = /^steps\.([a-z0-9_]+)/.exec(ref);
        if (m && !earlier.has(m[1])) issues.push({ path: `steps[${idx}].config.${k}`, message: `references steps.${m[1]} which is not an earlier step` });
      }
    }
    if (s.condition) {
      for (const ref of extractVariables(s.condition)) {
        const m = /^steps\.([a-z0-9_]+)/.exec(ref);
        if (m && !earlier.has(m[1])) issues.push({ path: `steps[${idx}].condition`, message: `references steps.${m[1]} which is not an earlier step` });
      }
    }
    return { ...s, config };
  });

  if (issues.length) return { ok: false, issues, warnings };
  return { ok: true, definition: { name: d.name, description: d.description ?? null, trigger: { type: d.trigger.type, config: triggerConfig }, steps }, warnings };
}

/** Human-readable one-liner for a step (member view, lists). */
export function describeStep(step: WorkflowDefinition["steps"][number], locale: "de" | "en"): string {
  const a = getAction(step.action);
  const name = a ? a.labels.name[locale] : step.action;
  return step.name ? `${step.name} (${name})` : name;
}

export function describeTrigger(trigger: WorkflowDefinition["trigger"], locale: "de" | "en"): string {
  const t = getTrigger(trigger.type);
  return t ? t.labels.name[locale] : trigger.type;
}
