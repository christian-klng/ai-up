import { modelCapabilities, type ProviderKind } from "./client";
import type { LlmModelCapabilityRow, LlmModelInfo, ReasoningLevel } from "@/server/db/schema";

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

/** Keeps a configured level usable: unknown or unsupported levels fall back to off. */
export function normalizeReasoningLevel(level: string | null | undefined, caps: ResolvedCapabilities): ReasoningLevel | undefined {
  if (!level || level === "none") return undefined;
  if (!caps.reasoning) return undefined;
  return caps.reasoningLevels.includes(level as ReasoningLevel) ? (level as ReasoningLevel) : undefined;
}
