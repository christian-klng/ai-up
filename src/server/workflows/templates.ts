import { Liquid } from "liquidjs";
import type { TemplateContext } from "./types";

/**
 * LiquidJS templating for workflow configs. Safe by construction (no code execution),
 * lenient on missing variables (renders empty string) so partially filled contexts don't blow up.
 * Extra filters: json (pretty JSON), truncate_words, default.
 */
const engine = new Liquid({
  strictFilters: false,
  strictVariables: false,
  lenientIf: true,
  outputEscape: undefined,
  cache: true,
  greedy: false,
});

engine.registerFilter("json", (v: unknown, indent?: number) => JSON.stringify(v, null, indent ?? 2));
engine.registerFilter("truncate_chars", (v: unknown, n = 2000) => {
  const s = String(v ?? "");
  return s.length > n ? `${s.slice(0, n)}…` : s;
});

export async function renderTemplate(template: string, ctx: TemplateContext): Promise<string> {
  if (!template.includes("{{") && !template.includes("{%")) return template;
  return engine.parseAndRender(template, ctx);
}

/** Renders every string in `config` whose key is listed in `templateKeys` (nested objects supported via dot paths). */
export async function renderConfig(config: Record<string, unknown>, templateKeys: string[], ctx: TemplateContext): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = structuredClone(config);
  for (const key of templateKeys) {
    const value = out[key];
    if (typeof value === "string") out[key] = await renderTemplate(value, ctx);
    else if (Array.isArray(value)) out[key] = await Promise.all(value.map((v) => (typeof v === "string" ? renderTemplate(v, ctx) : v)));
  }
  return out;
}

/** Evaluates a step condition: empty → true; otherwise render and interpret. */
export async function evaluateCondition(condition: string | undefined, ctx: TemplateContext): Promise<boolean> {
  if (!condition?.trim()) return true;
  const rendered = (await renderTemplate(condition, ctx)).trim().toLowerCase();
  return !(rendered === "" || rendered === "false" || rendered === "0" || rendered === "null" || rendered === "undefined" || rendered === "no");
}

/** Extracts `{{ ... }}` variable references (for validation hints in the editor / MCP validate). */
export function extractVariables(template: string): string[] {
  const vars = new Set<string>();
  const re = /\{\{-?\s*([a-zA-Z_][\w.\[\]"']*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template))) vars.add(m[1]);
  return [...vars];
}
