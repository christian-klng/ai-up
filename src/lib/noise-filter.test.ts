import { describe, expect, it } from "vitest";
import { DEFAULT_NOISE_FILTER_LEVEL, parseNoiseFilterLevel, suppressionDb } from "./noise-filter";

describe("noise filter levels", () => {
  it("defaults to the browser filter for unknown or missing values", () => {
    expect(DEFAULT_NOISE_FILTER_LEVEL).toBe("standard");
    expect(parseNoiseFilterLevel(null)).toBe("standard");
    expect(parseNoiseFilterLevel("loud")).toBe("standard");
    expect(parseNoiseFilterLevel("strong")).toBe("strong");
  });

  it("only adds DeepFilterNet above standard, stronger with each level", () => {
    expect(suppressionDb("standard")).toBeNull();
    expect(suppressionDb("medium")).toBeLessThan(suppressionDb("strong")!);
    expect(suppressionDb("strong")).toBe(100);
  });
});
