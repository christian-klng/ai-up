import { describe, expect, it } from "vitest";
import { mergeCapabilities, normalizeReasoningLevel } from "./capabilities";
import type { LlmModelCapabilityRow, LlmModelInfo } from "@/server/db/schema";

function row(part: Partial<LlmModelCapabilityRow>): LlmModelCapabilityRow {
  return {
    id: "r1",
    modelId: "glm-5.2",
    tools: null,
    structuredOutputs: null,
    vision: null,
    reasoningLevels: null,
    contextLength: null,
    notes: null,
    source: "https://example.test/docs",
    checkedAt: new Date(),
    updatedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...part,
  } as LlmModelCapabilityRow;
}

/** OpenRouter-style metadata: the provider describes itself. */
const openrouterInfo: LlmModelInfo = { id: "gpt-x", supportedParameters: ["tools", "temperature", "reasoning"], contextLength: 128000 };

describe("mergeCapabilities", () => {
  it("guesses when neither the table nor the provider says anything", () => {
    const caps = mergeCapabilities(undefined, undefined, "generic");
    expect(caps.origin).toBe("guess");
    // Optimistic on tools, pessimistic on reasoning – that is today's behaviour and stays.
    expect(caps.tools).toBe(true);
    expect(caps.reasoning).toBe(false);
    expect(caps.reasoningLevels).toEqual([]);
  });

  it("uses the provider's own metadata when it reports parameters", () => {
    const caps = mergeCapabilities(undefined, openrouterInfo, "openrouter");
    expect(caps.origin).toBe("provider");
    expect(caps.tools).toBe(true);
    expect(caps.reasoningLevels).toEqual(["none", "low", "medium", "high"]);
    expect(caps.contextLength).toBe(128000);
  });

  it("lets the admin's row win over the provider", () => {
    const caps = mergeCapabilities(row({ tools: false, reasoningLevels: ["none", "high", "max"] }), openrouterInfo, "openrouter");
    expect(caps.origin).toBe("manual");
    expect(caps.tools).toBe(false);
    expect(caps.reasoningLevels).toEqual(["none", "high", "max"]);
  });

  it("treats a null column as not stated, not as a denial", () => {
    // Only the reasoning levels were filled in; tool support must keep the fallback.
    const caps = mergeCapabilities(row({ reasoningLevels: ["none", "high"] }), openrouterInfo, "openrouter");
    expect(caps.tools).toBe(true);
    expect(caps.reasoningLevels).toEqual(["none", "high"]);
  });

  it("distinguishes an explicit empty list from an unfilled one", () => {
    const stated = mergeCapabilities(row({ reasoningLevels: [] }), openrouterInfo, "openrouter");
    expect(stated.reasoning).toBe(false);
    const unfilled = mergeCapabilities(row({}), openrouterInfo, "openrouter");
    expect(unfilled.reasoning).toBe(true);
  });

  it("keeps the provider's context length when the row leaves it open", () => {
    expect(mergeCapabilities(row({ tools: true }), openrouterInfo, "openrouter").contextLength).toBe(128000);
    expect(mergeCapabilities(row({ contextLength: 256000 }), openrouterInfo, "openrouter").contextLength).toBe(256000);
  });
});

describe("normalizeReasoningLevel", () => {
  const glm = mergeCapabilities(row({ reasoningLevels: ["none", "high", "max"] }), undefined, "generic");

  it("drops a level the model does not accept", () => {
    // The stored "medium" is exactly the case that silently misfired in production.
    expect(normalizeReasoningLevel("medium", glm)).toBeUndefined();
    expect(normalizeReasoningLevel("high", glm)).toBe("high");
  });

  it("treats none and empty as off", () => {
    expect(normalizeReasoningLevel("none", glm)).toBeUndefined();
    expect(normalizeReasoningLevel(null, glm)).toBeUndefined();
  });

  it("stays off for a model without reasoning", () => {
    const plain = mergeCapabilities(row({ reasoningLevels: [] }), undefined, "generic");
    expect(normalizeReasoningLevel("high", plain)).toBeUndefined();
  });
});
