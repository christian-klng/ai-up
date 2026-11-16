import { describe, expect, it } from "vitest";
import { formProblems, formSettingsSchema, isFormFieldAllowed, publicDefinition, DEFAULT_FORM_SUCCESS, DEFAULT_FORM_TEXTS } from "./collection-forms";
import type { StructureDefinition } from "./structures/types";
import { validateStructureAnswers } from "./structures/validate";

const def: StructureDefinition = {
  formatVersion: 1,
  elements: [
    { key: "hint", type: "info", label: "Hint", body: "Tell us" },
    { key: "what", type: "textarea", label: "What", required: true },
    { key: "category", type: "select", label: "Category", options: ["Bug", "Idea"], required: true },
    { key: "board", type: "kanban", label: "Board", seed: { columns: [] } },
    { key: "sections", type: "markdown", label: "Sections", multiple: true },
    { key: "details", type: "text", label: "Details", showIf: { key: "category", equals: "Bug" } },
  ],
};

describe("publicDefinition", () => {
  it("keeps the chosen fields in template order", () => {
    expect(publicDefinition(def, ["what", "hint"]).elements.map((e) => e.key)).toEqual(["hint", "what"]);
  });

  it("never exposes boards or accordion lists, even when chosen", () => {
    expect(publicDefinition(def, ["board", "sections", "what"]).elements.map((e) => e.key)).toEqual(["what"]);
    expect(isFormFieldAllowed(def.elements[3])).toBe(false);
    expect(isFormFieldAllowed(def.elements[4])).toBe(false);
  });

  it("lets a submission pass although a field kept internal is required", () => {
    const res = validateStructureAnswers(publicDefinition(def, ["what"]), { what: "It broke", category: "Nonsense" });
    expect(res).toEqual({ ok: true, answers: { what: "It broke" } });
  });

  it("hides a field that depends on an internal one", () => {
    const res = validateStructureAnswers(publicDefinition(def, ["what", "details"]), { what: "x", details: "y" });
    expect(res).toEqual({ ok: true, answers: { what: "x" } });
  });
});

describe("formProblems", () => {
  it("needs a template and at least one field to answer", () => {
    expect(formProblems(null, [])).toEqual(["noTemplate"]);
    expect(formProblems(def, [])).toEqual(["noFields"]);
    expect(formProblems(def, ["hint", "board"])).toEqual(["noFields"]);
    expect(formProblems(def, ["what"])).toEqual([]);
  });
});

describe("formSettingsSchema", () => {
  const base = { enabled: false, templateId: null, fieldKeys: [], texts: DEFAULT_FORM_TEXTS, contact: "off", success: DEFAULT_FORM_SUCCESS, mailReply: false, dailyLimit: 200 };

  it("accepts the defaults", () => {
    expect(formSettingsSchema.safeParse(base).success).toBe(true);
  });

  it("only redirects to https", () => {
    expect(formSettingsSchema.safeParse({ ...base, success: { ...DEFAULT_FORM_SUCCESS, redirectUrl: "https://example.com/thanks" } }).success).toBe(true);
    expect(formSettingsSchema.safeParse({ ...base, success: { ...DEFAULT_FORM_SUCCESS, redirectUrl: "javascript:alert(1)" } }).success).toBe(false);
    expect(formSettingsSchema.safeParse({ ...base, success: { ...DEFAULT_FORM_SUCCESS, redirectUrl: "http://example.com" } }).success).toBe(false);
  });
});
