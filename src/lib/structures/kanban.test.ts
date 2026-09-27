import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { KanbanBoard, StructureDefinition } from "./types";
import { fillSeeds, isKanbanBoard, isMediaLikeAnswer } from "./types";
import { flattenAnswersText, renderStructureMarkdown } from "./markdown";
import { migrateStructureAnswers } from "./migrate";
import { validateStructure, validateStructureAnswers } from "./validate";
import { hasAnswerValue } from "./visibility";
import {
  KANBAN_ORDER_REGEX,
  addCardOp,
  addColumnOp,
  applyKanbanOps,
  deleteColumnOp,
  initialOrderKeys,
  kanbanToLiveItems,
  kanbanToMarkdown,
  liveCards,
  liveColumns,
  liveItemsToKanban,
  moveCardOp,
  moveColumnOp,
  normalizeKanbanBoard,
  orderKeyBetween,
  kanbanIntentSchema,
  translateKanbanIntents,
} from "./kanban";

const board = (...columns: Array<[string, string, Array<[string, string]>]>): KanbanBoard => ({
  columns: columns.map(([id, title, cards]) => ({ id, title, cards: cards.map(([cid, ctitle]) => ({ id: cid, title: ctitle })) })),
});

const seed = board(["todo", "Offen", []], ["doing", "In Arbeit", []], ["done", "Erledigt", []]);

const def = (opts: { required?: boolean; lockColumns?: boolean } = {}): StructureDefinition => ({
  formatVersion: 1,
  elements: [{ key: "plan", type: "kanban", label: "Anforderungen", seed, ...opts }],
});

describe("kanban type guards", () => {
  it("does not mistake a board for a media answer", () => {
    expect(isMediaLikeAnswer({ columns: [] })).toBe(false);
    expect(isKanbanBoard({ columns: [] })).toBe(true);
  });

  it("counts a board as answered only once it holds a card", () => {
    expect(hasAnswerValue(seed)).toBe(false);
    expect(hasAnswerValue(board(["todo", "Offen", [["a", "Login"]]]))).toBe(true);
  });

  it("fills untouched boards with the seed", () => {
    expect(fillSeeds(def(), {}).plan).toEqual(seed);
  });
});

describe("normalizeKanbanBoard", () => {
  it("trims, drops blank cards and assigns ids that avoid given ones", () => {
    const { board: out, problems } = normalizeKanbanBoard({
      columns: [
        { title: " Offen ", cards: [{ title: " Login ", description: "a\r\nb " }, { title: "  " }, { id: "card1", title: "Suche" }] },
        { id: "col1", title: "Fertig" },
      ],
    });
    expect(problems).toEqual([]);
    expect(out).toEqual({
      columns: [
        { id: "col2", title: "Offen", cards: [{ id: "card2", title: "Login", description: "a\nb" }, { id: "card1", title: "Suche" }] },
        { id: "col1", title: "Fertig", cards: [] },
      ],
    });
  });

  it("reports duplicate ids across columns and cards, missing titles and limits", () => {
    const { problems } = normalizeKanbanBoard({ columns: [{ id: "x", title: "", cards: [{ id: "x", title: "" , description: "nur Text" }] }] });
    expect(problems.join(" | ")).toMatch(/duplicate card id "x"/);
    expect(problems.join(" | ")).toMatch(/column 1 needs a title/);
    expect(problems.join(" | ")).toMatch(/needs a title/);
    expect(normalizeKanbanBoard({ columns: [] }).problems).toContain("board needs at least one column");
    const many = Array.from({ length: 501 }, (_, i) => ({ title: `K${i}` }));
    expect(normalizeKanbanBoard({ columns: [{ title: "A", cards: many }] }).problems).toContain("at most 500 cards");
  });

  it("locks columns to the template: by id, then by title, the rest into the first column", () => {
    const { board: out, problems } = normalizeKanbanBoard(
      {
        columns: [
          { id: "doing", title: "Umbenannt", cards: [{ id: "a", title: "A" }] },
          { title: "erledigt", cards: [{ id: "b", title: "B" }] },
          { id: "extra", title: "Eigene Spalte", cards: [{ id: "c", title: "C" }, { id: "todo", title: "Kollision" }] },
        ],
      },
      { lockedColumns: seed.columns },
    );
    expect(problems).toEqual([]);
    expect(out.columns.map((c) => [c.id, c.title, c.cards.map((k) => k.title)])).toEqual([
      ["todo", "Offen", ["C", "Kollision"]],
      ["doing", "In Arbeit", ["A"]],
      ["done", "Erledigt", ["B"]],
    ]);
    // the card that claimed a column id got a fresh one
    expect(out.columns[0].cards[1].id).not.toBe("todo");
  });
});

describe("validation", () => {
  it("accepts a seed without ids and stores it with ids", () => {
    const res = validateStructure({ formatVersion: 1, elements: [{ key: "k", type: "kanban", label: "K", seed: { columns: [{ title: "A" }, { title: "B", cards: [{ title: "Start" }] }] } }] });
    expect(res.issues).toEqual([]);
    const el = res.def?.elements[0];
    expect(el?.type === "kanban" && el.seed).toEqual({ columns: [{ id: "col1", title: "A", cards: [] }, { id: "col2", title: "B", cards: [{ id: "card1", title: "Start" }] }] });
  });

  it("rejects a seed without columns or with an unknown colour", () => {
    expect(validateStructure({ formatVersion: 1, elements: [{ key: "k", type: "kanban", label: "K", seed: { columns: [] } }] }).def).toBeUndefined();
    expect(validateStructure({ formatVersion: 1, elements: [{ key: "k", type: "kanban", label: "K", seed: { columns: [{ title: "A", cards: [{ title: "x", color: "teal" }] }] } }] }).def).toBeUndefined();
  });

  it("requires a card when required, keeps an empty optional board", () => {
    expect(validateStructureAnswers(def({ required: true }), { plan: seed }).ok).toBe(false);
    const res = validateStructureAnswers(def(), { plan: seed });
    expect(res.ok && res.answers.plan).toEqual(seed);
  });

  it("rejects cards without a title and enforces locked columns", () => {
    expect(validateStructureAnswers(def(), { plan: { columns: [{ id: "todo", title: "Offen", cards: [{ title: "", description: "x" }] }] } }).ok).toBe(false);
    const res = validateStructureAnswers(def({ lockColumns: true }), { plan: { columns: [{ id: "neu", title: "Neu", cards: [{ id: "a", title: "A" }] }] } });
    expect(res.ok && (res.answers.plan as KanbanBoard).columns.map((c) => c.id)).toEqual(["todo", "doing", "done"]);
    expect(res.ok && (res.answers.plan as KanbanBoard).columns[0].cards).toEqual([{ id: "a", title: "A" }]);
  });
});

describe("markdown", () => {
  const filled: KanbanBoard = {
    columns: [
      { id: "todo", title: "Offen", cards: [{ id: "a", title: "Login", color: "green", description: "Magic Link\n\n- per Mail" }, { id: "b", title: "Suche" }] },
      { id: "done", title: "Erledigt", cards: [] },
    ],
  };

  it("renders one heading per column, colours as emoji, descriptions indented", () => {
    expect(kanbanToMarkdown(filled)).toBe(["### Offen", "- 🟢 **Login**\n\n  Magic Link\n\n  - per Mail\n- **Suche**", "### Erledigt"].join("\n\n"));
  });

  it("renders nothing for a board without cards", () => {
    expect(renderStructureMarkdown(def(), { plan: seed })).toBe("");
  });

  it("renders under the element label and indexes all text", () => {
    expect(renderStructureMarkdown(def(), { plan: filled }).startsWith("## Anforderungen\n\n### Offen")).toBe(true);
    expect(flattenAnswersText(def(), { plan: filled })).toContain("Offen Login Magic Link");
  });
});

describe("migration", () => {
  it("carries a board and re-locks it to the new template's columns", () => {
    const answers = { plan: board(["todo", "Offen", [["a", "A"]]], ["old", "Alt", [["b", "B"]]]) };
    const newDef: StructureDefinition = { formatVersion: 1, elements: [{ key: "plan", type: "kanban", label: "Plan", lockColumns: true, seed: board(["todo", "Offen", []], ["done", "Fertig", []]) }] };
    const res = migrateStructureAnswers(def(), newDef, answers);
    expect(res.carriedKeys).toEqual(["plan"]);
    expect((res.answers.plan as KanbanBoard).columns.map((c) => [c.id, c.cards.map((k) => k.id)])).toEqual([
      ["todo", ["a", "b"]],
      ["done", []],
    ]);
  });
});

describe("order keys", () => {
  it("finds a key strictly between any two keys", () => {
    const pairs: Array<[string | null, string | null]> = [[null, null], ["V", null], [null, "V"], ["V", "W"], ["V", "V1"], ["1", "2"], [null, "1"], ["z", null], ["0V", "1"]];
    for (const [a, b] of pairs) {
      const k = orderKeyBetween(a, b);
      expect(KANBAN_ORDER_REGEX.test(k)).toBe(true);
      if (a !== null) expect(k > a).toBe(true);
      if (b !== null) expect(k < b).toBe(true);
    }
    expect(() => orderKeyBetween("b", "a")).toThrow();
  });

  it("keeps keys short when inserting repeatedly at the front, end and middle", () => {
    let front: string | null = null;
    let end: string | null = null;
    for (let i = 0; i < 200; i++) {
      front = orderKeyBetween(null, front);
      end = orderKeyBetween(end, null);
    }
    expect(front!.length).toBeLessThan(12);
    expect(end!.length).toBeLessThan(12);
    let lo = "1";
    const hi = "2";
    for (let i = 0; i < 50; i++) lo = orderKeyBetween(lo, hi);
    expect(lo < hi && KANBAN_ORDER_REGEX.test(lo)).toBe(true);
  });

  it("spreads initial keys evenly, ascending and without trailing zeros", () => {
    for (const n of [1, 3, 30, 61, 62, 500]) {
      const keys = initialOrderKeys(n);
      expect(keys).toHaveLength(n);
      expect([...keys].sort()).toEqual(keys);
      expect(new Set(keys).size).toBe(n);
      expect(keys.every((k) => KANBAN_ORDER_REGEX.test(k))).toBe(true);
    }
  });
});

describe("live form", () => {
  const stored: KanbanBoard = {
    columns: [
      { id: "todo", title: "Offen", cards: [{ id: "a", title: "A", color: "red" }, { id: "b", title: "B" }, { id: "c", title: "C" }] },
      { id: "done", title: "Erledigt", cards: [{ id: "d", title: "D", description: "fertig" }] },
    ],
  };

  it("round-trips a stored board", () => {
    expect(liveItemsToKanban(kanbanToLiveItems(stored))).toEqual(stored);
    expect(kanbanToLiveItems(stored, { lockColumns: true }).filter((i) => i.kind === "column").every((i) => i.kind === "column" && i.locked)).toBe(true);
  });

  it("moves, adds and reorders through upserts", () => {
    let items = kanbanToLiveItems(stored);
    items = applyKanbanOps(items, [moveCardOp(items, "a", "done", 1)!]);
    items = applyKanbanOps(items, [moveCardOp(items, "c", "todo", 0)!]);
    items = applyKanbanOps(items, [addCardOp(items, "todo", { id: "e", title: "E" }, 1)]);
    items = applyKanbanOps(items, [addColumnOp(items, { id: "doing", title: "In Arbeit" }, 1)]);
    const out = liveItemsToKanban(items);
    expect(out.columns.map((c) => [c.id, c.cards.map((k) => k.id)])).toEqual([
      ["todo", ["c", "e", "b"]],
      ["doing", []],
      ["done", ["d", "a"]],
    ]);
    items = applyKanbanOps(items, [moveColumnOp(items, "done", 0)!]);
    expect(liveColumns(items).map((c) => c.id)).toEqual(["done", "todo", "doing"]);
  });

  it("merges concurrent moves of different cards", () => {
    const base = kanbanToLiveItems(stored);
    const anna = moveCardOp(base, "a", "done", 0)!;
    const ben = moveCardOp(base, "c", "done", 1)!;
    const merged = applyKanbanOps(base, [anna, ben]);
    expect(liveCards(merged, "done").map((c) => c.id)).toEqual(["a", "d", "c"]);
  });

  it("keeps cards whose column was deleted meanwhile", () => {
    let items = kanbanToLiveItems(stored);
    const move = moveCardOp(items, "b", "done", 0)!;
    items = applyKanbanOps(items, [{ op: "delete", id: "done" }, move]);
    const out = liveItemsToKanban(items);
    expect(out.columns.map((c) => c.id)).toEqual(["todo"]);
    expect(out.columns[0].cards.map((c) => c.id)).toEqual(["a", "c", "b", "d"]);
  });

  it("deletes only empty columns and never the last one", () => {
    const items = kanbanToLiveItems(stored);
    expect(deleteColumnOp(items, "todo")).toBeNull();
    const emptied = applyKanbanOps(items, [{ op: "delete", id: "d" }]);
    expect(deleteColumnOp(emptied, "done")).toEqual({ op: "delete", id: "done" });
    const single = kanbanToLiveItems(board(["only", "Einzige", []]));
    expect(deleteColumnOp(single, "only")).toBeNull();
  });

  it("returns null for ops on cards or columns that are gone", () => {
    const items = kanbanToLiveItems(stored);
    expect(moveCardOp(items, "zzz", "todo", 0)).toBeNull();
    expect(moveColumnOp(items, "zzz", 0)).toBeNull();
  });
});

describe("intents", () => {
  const stored: KanbanBoard = {
    columns: [
      { id: "todo", title: "Offen", cards: [{ id: "a", title: "Login" }, { id: "b", title: "Suche" }] },
      { id: "done", title: "Erledigt", cards: [] },
    ],
  };

  it("resolves by id or unique title and applies intents one after another", () => {
    const { items, results } = translateKanbanIntents(kanbanToLiveItems(stored), [
      { op: "addColumn", title: "In Arbeit", position: 1 },
      { op: "moveCard", card: "suche", column: "in arbeit" },
      { op: "addCard", column: "In Arbeit", title: "Export", color: "green", description: "PDF\r\n" },
      { op: "updateCard", card: "a", title: "Magic Link", color: "red" },
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    const out = liveItemsToKanban(items);
    expect(out.columns.map((c) => [c.title, c.cards.map((k) => k.title)])).toEqual([
      ["Offen", ["Magic Link"]],
      ["In Arbeit", ["Suche", "Export"]],
      ["Erledigt", []],
    ]);
    expect(out.columns[1].cards[1]).toMatchObject({ color: "green", description: "PDF" });
  });

  it("clears description and colour with null", () => {
    const board: KanbanBoard = { columns: [{ id: "c", title: "C", cards: [{ id: "x", title: "X", description: "d", color: "red" }] }] };
    const { items } = translateKanbanIntents(kanbanToLiveItems(board), [{ op: "updateCard", card: "x", description: null, color: null }]);
    expect(liveItemsToKanban(items).columns[0].cards[0]).toEqual({ id: "x", title: "X" });
  });

  it("skips what does not fit and keeps going", () => {
    const dup: KanbanBoard = { columns: [{ id: "c", title: "C", cards: [{ id: "x", title: "Gleich" }, { id: "y", title: "Gleich" }] }, { id: "d", title: "D", cards: [] }] };
    const { ops, results } = translateKanbanIntents(kanbanToLiveItems(dup), [
      { op: "deleteCard", card: "gleich" },
      { op: "deleteColumn", column: "C" },
      { op: "moveCard", card: "x", column: "nirgends" },
      { op: "deleteColumn", column: "D" },
    ]);
    expect(results.map((r) => r.ok)).toEqual([false, false, false, true]);
    expect(results[0].ok === false && results[0].error).toMatch(/use the id \(x, y\)/);
    expect(ops).toEqual([{ op: "delete", id: "d" }]);
  });

  it("refuses column changes when the template fixes the columns", () => {
    const { ops, results } = translateKanbanIntents(kanbanToLiveItems(stored, { lockColumns: true }), [{ op: "addColumn", title: "Neu" }, { op: "renameColumn", column: "todo", title: "X" }, { op: "addCard", column: "todo", title: "geht" }], { lockColumns: true });
    expect(results.map((r) => r.ok)).toEqual([false, false, true]);
    expect(ops).toHaveLength(1);
  });
});

describe("intent schema", () => {
  it("becomes a self-contained JSON schema for LLM tool calls (no $ref – some providers reject it)", () => {
    const json = JSON.stringify(z.toJSONSchema(z.object({ ops: z.array(kanbanIntentSchema) }), { io: "input" }));
    expect(json).not.toContain("$ref");
    expect(json).toContain("moveCard");
  });
});
