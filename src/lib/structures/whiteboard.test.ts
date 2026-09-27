import { describe, expect, it } from "vitest";
import type { StructureDefinition, WhiteboardItem } from "./types";
import { isMediaLikeAnswer } from "./types";
import { renderStructureMarkdown, flattenAnswersText } from "./markdown";
import { validateStructure, validateStructureAnswers } from "./validate";
import { hasAnswerValue } from "./visibility";
import { layoutMissingItems, stampWhiteboardAuthors, whiteboardToMarkdown } from "./whiteboard";

const sticky = (id: string, x: number, y: number, text: string, extra: Partial<WhiteboardItem> = {}): WhiteboardItem => ({ id, kind: "sticky", x, y, w: 100, h: 100, z: 1, text, ...extra });
const box = (id: string, x: number, y: number, w: number, h: number, text: string, extra: Partial<WhiteboardItem> = {}): WhiteboardItem => ({ id, kind: "shape", shape: "rect", x, y, w, h, z: 0, text, ...extra });

const def = (seed?: WhiteboardItem[], required = false): StructureDefinition => ({
  formatVersion: 1,
  elements: [{ key: "board", type: "whiteboard", label: "Brainstorming", required, ...(seed ? { seed: { items: seed } } : {}) }],
});

describe("whiteboard type guards", () => {
  it("does not mistake a board for a media answer", () => {
    expect(isMediaLikeAnswer({ items: [] })).toBe(false);
  });
  it("counts a board as answered only with own content", () => {
    expect(hasAnswerValue({ items: [] })).toBe(false);
    expect(hasAnswerValue({ items: [box("b", 0, 0, 400, 400, "Gut", { locked: true })] })).toBe(false);
    expect(hasAnswerValue({ items: [sticky("a", 0, 0, "  ")] })).toBe(false);
    expect(hasAnswerValue({ items: [sticky("a", 0, 0, "Idee")] })).toBe(true);
  });
});

describe("whiteboardToMarkdown", () => {
  it("lists free items first, then one heading per box in reading order", () => {
    const md = whiteboardToMarkdown({
      items: [
        box("bad", 600, 0, 500, 500, "Was verbessern"),
        box("good", 0, 0, 500, 500, "Was lief gut"),
        sticky("g2", 50, 250, "Gute Doku"),
        sticky("g1", 50, 50, "Schnelles Onboarding"),
        sticky("b1", 650, 60, "Zu viele Meetings"),
        sticky("free", 0, 700, "Freie Idee"),
      ],
    });
    expect(md).toBe(["- Freie Idee", "### Was lief gut\n\n- Schnelles Onboarding\n- Gute Doku", "### Was verbessern\n\n- Zu viele Meetings"].join("\n\n"));
  });

  it("treats items within the row tolerance as one row, left to right", () => {
    const md = whiteboardToMarkdown({ items: [sticky("r", 300, 20, "rechts"), sticky("l", 0, 0, "links")] });
    expect(md).toBe("- links\n- rechts");
  });

  it("nests boxes and never makes a box its own or a larger box's child", () => {
    const md = whiteboardToMarkdown({
      items: [box("outer", 0, 0, 1000, 1000, "Außen"), box("inner", 100, 100, 400, 400, "Innen"), sticky("s", 150, 150, "Tief")],
    });
    expect(md).toBe("### Außen\n\n#### Innen\n\n- Tief");
  });

  it("renders images and skips empty items, multi-line text on one line", () => {
    const md = whiteboardToMarkdown({
      items: [
        { id: "img", kind: "image", x: 0, y: 0, w: 100, h: 100, z: 1, mediaId: "00000000-0000-4000-8000-000000000001", alt: "Skizze" },
        sticky("empty", 0, 200, ""),
        sticky("multi", 0, 400, "Zeile 1\nZeile 2"),
      ],
    });
    expect(md).toBe("- ![Skizze](/api/files/00000000-0000-4000-8000-000000000001)\n- Zeile 1 / Zeile 2");
  });
});

describe("layoutMissingItems", () => {
  it("places items without coordinates in a grid below the placed ones", () => {
    const out = layoutMissingItems([
      { id: "a", kind: "sticky", x: 0, y: 0, w: 100, h: 100, z: 5 },
      { id: "b", kind: "sticky", text: "neu" },
      { id: "c", kind: "text", text: "auch neu" },
    ]);
    expect(out[0]).toMatchObject({ x: 0, y: 0 });
    expect(out[1]).toMatchObject({ x: 0, y: 180, w: 200, h: 200, z: 6 });
    expect(out[2]).toMatchObject({ x: 240, y: 180, z: 7 });
  });
});

describe("validation", () => {
  it("rejects duplicate ids and image items without a source in the seed", () => {
    const res = validateStructure({ formatVersion: 1, elements: [{ key: "b", type: "whiteboard", label: "B", seed: { items: [{ id: "x", kind: "sticky" }, { id: "x", kind: "image" }] } }] });
    expect(res.def).toBeUndefined();
    expect(res.issues.map((i) => i.message).join(" ")).toMatch(/duplicate item id/);
  });

  it("fills seed geometry and strips authors from the stored definition", () => {
    const res = validateStructure({ formatVersion: 1, elements: [{ key: "b", type: "whiteboard", label: "B", seed: { items: [{ id: "q", kind: "shape", text: "Stärken", locked: true, createdBy: "u1" }] } }] });
    const el = res.def?.elements[0];
    expect(el?.type === "whiteboard" && el.seed?.items[0]).toMatchObject({ x: 0, y: 0, w: 480, h: 360, locked: true });
    expect(el?.type === "whiteboard" && el.seed?.items[0].createdBy).toBeUndefined();
  });

  it("puts locked seed items back and drops locked flags from input", () => {
    const seed = [box("frame", 0, 0, 500, 500, "Stärken", { locked: true })];
    const res = validateStructureAnswers(def(seed), {
      board: { items: [box("frame", 999, 999, 100, 100, "gehackt", { locked: true }), sticky("s", 10, 10, "Idee", { locked: true })] },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const items = (res.answers.board as { items: WhiteboardItem[] }).items;
    expect(items.find((i) => i.id === "frame")).toMatchObject({ x: 0, text: "Stärken", locked: true });
    expect(items.find((i) => i.id === "s")?.locked).toBeUndefined();
  });

  it("requires an own item when the element is required", () => {
    const seed = [box("frame", 0, 0, 500, 500, "Stärken", { locked: true })];
    const res = validateStructureAnswers(def(seed, true), { board: { items: seed } });
    expect(res.ok).toBe(false);
  });

  it("keeps the seed-only board when optional", () => {
    const seed = [box("frame", 0, 0, 500, 500, "Stärken", { locked: true })];
    const res = validateStructureAnswers(def(seed), { board: { items: seed } });
    expect(res.ok && res.answers.board).toEqual({ items: seed });
  });
});

describe("stampWhiteboardAuthors", () => {
  it("keeps existing authors, stamps new items with the actor and ignores input authors", () => {
    const d = def([box("frame", 0, 0, 500, 500, "Seed", { locked: true })]);
    const prev = { board: { items: [sticky("old", 0, 0, "alt", { createdBy: "anna" })] } };
    const next = { board: { items: [box("frame", 0, 0, 500, 500, "Seed", { locked: true }), sticky("old", 0, 0, "alt", { createdBy: "mallory" }), sticky("new", 0, 0, "neu", { createdBy: "mallory" })] } };
    const out = stampWhiteboardAuthors(d, next, prev, "bernd").board as { items: WhiteboardItem[] };
    expect(out.items.map((i) => i.createdBy)).toEqual([undefined, "anna", "bernd"]);
  });
});

describe("entry markdown", () => {
  it("renders the board under the element label and indexes its text", () => {
    const answers = { board: { items: [sticky("a", 0, 0, "Idee A"), { id: "i", kind: "image" as const, x: 0, y: 200, w: 10, h: 10, z: 1, url: "https://example.org/a.png", alt: "Bild" }] } };
    expect(renderStructureMarkdown(def(), answers)).toBe("## Brainstorming\n\n- Idee A\n- ![Bild](https://example.org/a.png)");
    expect(flattenAnswersText(def(), answers)).toContain("Idee A Bild");
  });
});
