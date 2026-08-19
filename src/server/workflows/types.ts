import type { z } from "zod";
import type { StepUsage, WorkflowDefinition } from "@/server/db/schema";

/**
 * Registry contracts for triggers and actions. Everything user-facing here is English
 * (ids, field names, MCP docs); UI labels are localized via `labels`.
 */

export type Localized = { de: string; en: string };

/** Field descriptor used to render admin forms and to document configs for MCP. */
export type FieldSpec = {
  key: string;
  label: Localized;
  help?: Localized;
  type: "text" | "textarea" | "number" | "boolean" | "select" | "multiselect" | "json" | "template" | "area" | "content-types" | "llm-model" | "audience" | "cron";
  required?: boolean;
  placeholder?: string;
  options?: { value: string; label: Localized }[];
  min?: number;
  max?: number;
  step?: number;
  /** Show only when another field has a given value */
  showIf?: { key: string; equals: unknown };
};

export type TemplateContext = {
  trigger: Record<string, unknown>;
  steps: Record<string, { output: Record<string, unknown> }>;
  app: { name: string; purpose: string; url: string };
  run: { id: string; workflowId: string; workflowName: string; triggeredBy: string | null };
  now: string;
};

export type ActionRunContext = {
  runId: string;
  workflowId: string;
  workflowName: string;
  stepId: string;
  triggeredBy: string | null;
  depth: number;
  template: TemplateContext;
  /** structured logging per step */
  log: (message: string, data?: Record<string, unknown>) => void;
};

export type ActionResult = { output: Record<string, unknown>; usage?: StepUsage };

export type ActionDefinition<C = Record<string, unknown>> = {
  type: string;
  labels: { name: Localized; description: Localized };
  /** English doc string for MCP / LLM clients */
  doc: string;
  configSchema: z.ZodType<C>;
  fields: FieldSpec[];
  /** Keys whose values are Liquid templates and get rendered before validation/run */
  templateKeys: string[];
  /** Describes the output shape (for docs and the editor's variable picker) */
  outputDoc: Record<string, string>;
  /** Timeout for one execution */
  timeoutMs: number;
  run: (config: C, ctx: ActionRunContext) => Promise<ActionResult>;
};

export type TriggerDefinition<C = Record<string, unknown>> = {
  type: string;
  labels: { name: Localized; description: Localized };
  doc: string;
  configSchema: z.ZodType<C>;
  fields: FieldSpec[];
  /** Describes the payload available as {{ trigger.* }} */
  payloadDoc: Record<string, string>;
  /** Example payload for manual test runs */
  samplePayload: Record<string, unknown>;
  /** For event triggers: does this event match the config? */
  matches?: (config: C, payload: Record<string, unknown>) => boolean;
  /** Domain event types this trigger listens to (undefined for schedule/manual) */
  eventTypes?: string[];
};

export type ValidatedDefinition = WorkflowDefinition;
