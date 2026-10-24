import { describe, expect, it } from "vitest";
import { collectEntryMediaIds, firstImageMediaId, postExcerpt } from "./posts";
import { renderStructureMarkdown } from "./structures/markdown";
import type { StructureDefinition } from "./structures/types";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("collectEntryMediaIds", () => {
  it("collects uploads from markdown and the media field, once each", () => {
    const md = `![Cover](/api/files/${A})\n\nText [file](/api/files/${B}) and again /api/files/${A}`;
    expect(collectEntryMediaIds(md, B).sort()).toEqual([A, B].sort());
  });

  it("ignores everything that is not an upload path", () => {
    expect(collectEntryMediaIds(`https://example.com/${A} /api/files/not-a-uuid`, null)).toEqual([]);
  });
});

describe("firstImageMediaId", () => {
  it("finds the first uploaded image", () => {
    expect(firstImageMediaId(`[link](/api/files/${B})\n\n![x](/api/files/${A})`)).toBe(A);
    expect(firstImageMediaId("no images")).toBeNull();
  });
});

describe("postExcerpt", () => {
  it("skips headings and images and strips inline markup", () => {
    const md = `## Heading\n\n![x](/api/files/${A})\n\nThis is **bold** and a [link](https://x.y).\n\nSecond paragraph.`;
    expect(postExcerpt(md)).toBe("This is bold and a link.");
  });

  it("cuts long text at a word boundary", () => {
    const text = "word ".repeat(100).trim();
    const excerpt = postExcerpt(text, 50);
    expect(excerpt.length).toBeLessThanOrEqual(52);
    expect(excerpt.endsWith(" …")).toBe(true);
  });

  it("is empty without prose", () => {
    expect(postExcerpt("- a\n- b\n\n```mermaid\nflowchart\n```")).toBe("");
  });
});

describe("renderStructureMarkdown in post mode", () => {
  const def: StructureDefinition = {
    formatVersion: 1,
    intro: "Fill this in carefully.",
    elements: [
      { key: "hint", type: "info", label: "Hint", body: "Only for authors" },
      { key: "cover", type: "image", label: "Cover" },
      { key: "teaser", type: "textarea", label: "Teaser" },
      { key: "tags", type: "chips", label: "Tags", options: ["a", "b"] },
      { key: "body", type: "markdown", label: "Text" },
    ],
  };
  const answers = { cover: { mediaId: A }, teaser: "Short teaser.", tags: ["a"], body: "Main text." };

  it("reads as an article: no intro, no info, no labels above single values", () => {
    const md = renderStructureMarkdown(def, answers, undefined, { post: true, skipKeys: new Set(["cover"]) });
    expect(md).toBe("Short teaser.\n\n## Tags\n\n- a\n\nMain text.");
  });

  it("keeps the member view unchanged", () => {
    const md = renderStructureMarkdown(def, answers);
    expect(md).toContain("Fill this in carefully.");
    expect(md).toContain("## Teaser");
    expect(md).toContain(`## Cover\n\n![Cover](/api/files/${A})`);
  });
});
