import { describe, expect, it } from "vitest";
import { brandInitials, mailBrandColors } from "./brand";

describe("brandInitials", () => {
  it("takes the first letters of up to two words", () => {
    expect(brandInitials("KI-Netzwerk Test")).toBe("KT");
    expect(brandInitials("ai up Community")).toBe("AU");
    expect(brandInitials("Solo")).toBe("S");
  });

  it("falls back when the name has no letters", () => {
    expect(brandInitials("")).toBe("A");
    expect(brandInitials("   ")).toBe("A");
  });
});

describe("mailBrandColors", () => {
  it("puts white text on a dark brand color and dark text on a light one", () => {
    expect(mailBrandColors("#0f766e")).toEqual({ color: "#0f766e", foreground: "#ffffff" });
    expect(mailBrandColors("#FDE047")).toEqual({ color: "#fde047", foreground: "#111827" });
  });

  it("falls back to neutral dark for a missing or broken color", () => {
    expect(mailBrandColors(undefined)).toEqual({ color: "#111827", foreground: "#ffffff" });
    expect(mailBrandColors("red")).toEqual({ color: "#111827", foreground: "#ffffff" });
    expect(mailBrandColors("#abc")).toEqual({ color: "#111827", foreground: "#ffffff" });
  });
});
