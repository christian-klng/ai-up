import { describe, expect, it } from "vitest";
import { markdownToPlainText } from "./meetings";

describe("markdownToPlainText", () => {
  it("keeps plain text as it is, on one line", () => {
    expect(markdownToPlainText("Ein halber Tag zum Ausprobieren.\n\nBitte Laptop mitbringen.")).toBe("Ein halber Tag zum Ausprobieren. Bitte Laptop mitbringen.");
  });

  it("drops headings, list markers, quotes and emphasis", () => {
    const md = "## Agenda\n\n1. **Begrüßung**\n2. *Input*\n\n- für Gründer:innen\n\n> Laptop mitbringen";
    expect(markdownToPlainText(md)).toBe("Agenda Begrüßung Input für Gründer:innen Laptop mitbringen");
  });

  it("keeps the text of links and drops the URL", () => {
    expect(markdownToPlainText("Mehr auf [unserer Seite](https://ai-up.club) lesen")).toBe("Mehr auf unserer Seite lesen");
  });

  it("unescapes characters the editor escaped", () => {
    expect(markdownToPlainText("1\\. Termin \\*nicht\\* fett")).toBe("1. Termin *nicht* fett");
  });
});
