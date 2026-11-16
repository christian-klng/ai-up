import { describe, expect, it } from "vitest";
import { formProblems, formSettingsSchema, isFormFieldAllowed, publicDefinition, DEFAULT_FORM_SUCCESS, DEFAULT_FORM_TEXTS } from "./collection-forms";
import type { StructureDefinition } from "./structures/types";
import { validateStructureAnswers } from "./structures/validate";
import { collectFormCollectionIds, validateLandingDefinition } from "./landing-schema";
import { FORM_EMBED_SCRIPT } from "./form-embed-script";

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

describe("formSettingsSchema limits", () => {
  const base = { enabled: false, templateId: null, fieldKeys: [], texts: DEFAULT_FORM_TEXTS, contact: "off", success: DEFAULT_FORM_SUCCESS, mailReply: false, dailyLimit: 200 };

  it("bounds the wait for a workflow's answer", () => {
    expect(formSettingsSchema.safeParse({ ...base, success: { ...DEFAULT_FORM_SUCCESS, waitSeconds: 4 } }).success).toBe(false);
    expect(formSettingsSchema.safeParse({ ...base, success: { ...DEFAULT_FORM_SUCCESS, waitSeconds: 60 } }).success).toBe(true);
    expect(formSettingsSchema.safeParse({ ...base, success: { ...DEFAULT_FORM_SUCCESS, waitSeconds: 61 } }).success).toBe(false);
  });

  it("needs a positive daily limit", () => {
    expect(formSettingsSchema.safeParse({ ...base, dailyLimit: 0 }).success).toBe(false);
  });
});

describe("form section of site pages", () => {
  const id = "683c6752-39df-4fd1-b89a-899338763e49";

  it("names a collection and shows the form in the page by default", () => {
    const res = validateLandingDefinition({ sections: [{ type: "form", collectionId: id }] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.definition.sections[0]).toMatchObject({ type: "form", display: "inline" });
    expect(collectFormCollectionIds(res.definition)).toEqual([id]);
  });

  it("takes no token or address – only the collection decides what is shown", () => {
    expect(validateLandingDefinition({ sections: [{ type: "form", collectionId: "not-a-uuid" }] }).ok).toBe(false);
    expect(validateLandingDefinition({ sections: [{ type: "form", collectionId: id, display: "popup" }] }).ok).toBe(false);
    const res = validateLandingDefinition({ sections: [{ type: "form", collectionId: id, token: "x", url: "https://evil.example/f.js" }] });
    expect(res.ok && Object.keys(res.definition.sections[0])).toEqual(["type", "collectionId", "display"]);
  });

  it("lists a collection once however often it is shown", () => {
    const res = validateLandingDefinition({ sections: [{ type: "form", collectionId: id }, { type: "form", collectionId: id, display: "floating" }] });
    expect(res.ok && collectFormCollectionIds(res.definition)).toEqual([id]);
  });
});

describe("embed script", () => {
  it("is valid JavaScript", () => {
    expect(() => new Function(FORM_EMBED_SCRIPT)).not.toThrow();
  });

  it("only listens to its own origin and only redirects to https", () => {
    expect(FORM_EMBED_SCRIPT).toContain("event.origin !== origin");
    expect(FORM_EMBED_SCRIPT).toContain("/^https:\\/\\//.test(data.url)");
  });
});
