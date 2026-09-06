import { describe, expect, it } from "vitest";
import { describeStructure } from "./describe";
import type { StructureDefinition } from "@/lib/structures/types";

const definition: StructureDefinition = {
  formatVersion: 1,
  intro: "Für Kurzanleitungen.",
  elements: [
    { key: "hinweis", type: "info", label: "Hinweis", body: "Bitte kurz halten." },
    { key: "body", type: "markdown", label: "Text", required: true, help: "Die eigentliche Anleitung." },
    { key: "level", type: "select", label: "Niveau", options: ["Anfang", "Fortgeschritten"] },
    { key: "tags", type: "chips", label: "Schlagworte", options: ["ki", "prozess"] },
    { key: "faq", type: "qa", label: "Fragen" },
    { key: "detail", type: "textarea", label: "Detail", showIf: { key: "level", equals: "Fortgeschritten" } },
  ],
};

describe("describeStructure", () => {
  const out = describeStructure("Anleitung", definition);

  it("names every answerable element by key and skips info blocks", () => {
    expect(out).toContain("- body (Text)");
    expect(out).toContain("- level (Niveau)");
    expect(out).toContain("- faq (Fragen)");
    expect(out).not.toContain("hinweis");
  });

  it("spells out the allowed values so the model can answer without guessing", () => {
    expect(out).toContain('one of: "Anfang", "Fortgeschritten"');
    expect(out).toContain('array of strings out of: "ki", "prozess"');
    expect(out).toContain('array of { "question": string, "answer": string }');
  });

  it("marks required, optional and conditional elements", () => {
    expect(out).toContain("- body (Text) → string (markdown) [required]");
    expect(out).toContain("- level (Niveau) → string, one of: \"Anfang\", \"Fortgeschritten\" [optional]");
    expect(out).toContain('[optional, only when "level" matches]');
  });

  it("distinguishes a single markdown field from an accordion list", () => {
    const multi = describeStructure("X", { formatVersion: 1, elements: [{ key: "sections", type: "markdown", label: "Abschnitte", multiple: true }] });
    expect(multi).toContain('array of { "title": string, "body": string }');
  });

  it("carries the intro and the help texts", () => {
    expect(out).toContain("Für Kurzanleitungen.");
    expect(out).toContain("Die eigentliche Anleitung.");
  });
});
