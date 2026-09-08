import { modelCapabilities, type ProviderKind } from "./client";
import type { LlmModelCapabilityRow, LlmModelInfo, ReasoningLevel } from "@/server/db/schema";

export type CapabilityFields = Pick<LlmModelCapabilityRow, "tools" | "structuredOutputs" | "vision" | "reasoningLevels" | "contextLength" | "notes">;

/**
 * Effective model capabilities: the admin's table wins, then whatever the provider reports, then a
 * heuristic (see docs/modell-faehigkeiten.md). Pure – the database access lives in providers.ts,
 * so the resolution order can be unit tested.
 */

/** What OpenAI-style providers accept when they only tell us "this model reasons". */
export const DEFAULT_REASONING_LEVELS: ReasoningLevel[] = ["none", "low", "medium", "high"];

export type ResolvedCapabilities = {
  temperature: boolean;
  topP: boolean;
  maxTokens: boolean;
  seed: boolean;
  stop: boolean;
  structuredOutputs: boolean;
  tools: boolean;
  /** true when a reasoning level can be steered at all */
  reasoning: boolean;
  /** accepted levels; empty means the model has no reasoning knob */
  reasoningLevels: ReasoningLevel[];
  contextLength: number | null;
  /** where the answer came from – shown in the admin so a guess is recognisable as one */
  origin: "manual" | "provider" | "guess";
};

/**
 * Merges one capability row over the provider's own metadata.
 * A null column means "not stated" and keeps the fallback – never "cannot".
 */
export function mergeCapabilities(row: LlmModelCapabilityRow | undefined, info: LlmModelInfo | undefined, kind: ProviderKind | undefined): ResolvedCapabilities {
  const base = modelCapabilities(info, kind);
  const reported = !!info?.supportedParameters;
  const fallbackLevels = base.reasoning ? DEFAULT_REASONING_LEVELS : [];
  const contextLength = info?.contextLength ?? null;

  if (!row) {
    return { ...base, reasoningLevels: fallbackLevels, contextLength, origin: reported ? "provider" : "guess" };
  }
  const levels = row.reasoningLevels ?? fallbackLevels;
  return {
    ...base,
    tools: row.tools ?? base.tools,
    structuredOutputs: row.structuredOutputs ?? base.structuredOutputs,
    reasoning: levels.length > 0,
    reasoningLevels: levels,
    contextLength: row.contextLength ?? contextLength,
    origin: "manual",
  };
}

/**
 * What is *stated* about a model, as a tri-state – `undefined` means nobody said anything.
 * Different from `mergeCapabilities`, which always answers with a fallback: pickers must be able to
 * tell "unknown" from "no", so they can warn instead of silently offering something that does nothing.
 */
export function statedToolSupport(row: Pick<LlmModelCapabilityRow, "tools"> | undefined, info: LlmModelInfo | undefined): boolean | undefined {
  if (row?.tools !== undefined && row?.tools !== null) return row.tools;
  return info?.supportedParameters ? info.supportedParameters.includes("tools") : undefined;
}

export function statedReasoningLevels(row: Pick<LlmModelCapabilityRow, "reasoningLevels"> | undefined, info: LlmModelInfo | undefined): ReasoningLevel[] | undefined {
  if (row?.reasoningLevels) return row.reasoningLevels;
  if (!info?.supportedParameters) return undefined;
  return modelCapabilities(info).reasoning ? DEFAULT_REASONING_LEVELS : [];
}

/** Keeps a configured level usable: unknown or unsupported levels fall back to off. */
export function normalizeReasoningLevel(level: string | null | undefined, caps: ResolvedCapabilities): ReasoningLevel | undefined {
  if (!level || level === "none") return undefined;
  if (!caps.reasoning) return undefined;
  return caps.reasoningLevels.includes(level as ReasoningLevel) ? (level as ReasoningLevel) : undefined;
}

/** One model's stated capabilities. `undefined` keeps the stored value, `null` clears it. */
export type CapabilityInput = { modelId: string } & Partial<CapabilityFields>;

/**
 * Applies an input over the stored row. Merge, not replace: a partial correction must not silently
 * wipe fields the caller did not mention – but `null` explicitly resets one to "not stated".
 */
export function mergeCapabilityInput(existing: CapabilityFields | undefined, input: CapabilityInput): CapabilityFields {
  const pick = <K extends keyof CapabilityFields>(key: K): CapabilityFields[K] => (input[key] === undefined ? (existing?.[key] ?? null) : (input[key] as CapabilityFields[K]));
  return {
    tools: pick("tools"),
    structuredOutputs: pick("structuredOutputs"),
    vision: pick("vision"),
    reasoningLevels: pick("reasoningLevels"),
    contextLength: pick("contextLength"),
    notes: pick("notes"),
  };
}

/** Whether a write actually changes anything – refreshing `checkedAt` alone is not a change. */
export function capabilityFingerprint(fields: CapabilityFields, source: string): string {
  return JSON.stringify([fields.tools, fields.structuredOutputs, fields.vision, fields.reasoningLevels, fields.contextLength, fields.notes, source]);
}
