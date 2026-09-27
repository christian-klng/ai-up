import { describe, expect, it } from "vitest";
import type { KanbanBoard, StructureElement } from "./types";
import { applyKanbanOps, kanbanToLiveItems, moveCardOp, type KanbanLiveItem } from "./kanban";
import { canonicalBoard, isCollaborativeBoard, liveItemsOf, liveLimits, storedBoardOf, type LiveBoardElement } from "./live-boards";

const seed: KanbanBoard = { columns: [{ id: "todo", title: "Offen", cards: [] }, { id: "done", title: "Erledigt", cards: [] }] };
const kanban = (extra: Partial<Extract<StructureElement, { type: "kanban" }>> = {}): LiveBoardElement => ({ key: "plan", type: "kanban", label: "Plan", seed, ...extra });
const filled: KanbanBoard = { columns: [{ id: "todo", title: "Offen", cards: [{ id: "a", title: "A" }, { id: "b", title: "B" }] }, { id: "done", title: "Erledigt", cards: [] }] };

describe("live boards", () => {
  it("are collaborative unless switched off, for both kinds", () => {
    expect(isCollaborativeBoard(kanban())).toBe(true);
    expect(isCollaborativeBoard(kanban({ collaborative: false }))).toBe(false);
    expect(isCollaborativeBoard({ key: "w", type: "whiteboard", label: "W" })).toBe(true);
    expect(isCollaborativeBoard({ key: "t", type: "text", label: "T" })).toBe(false);
  });

  it("start a kanban session from the answer or the seed, locking fixed columns", () => {
    expect(storedBoardOf(kanban(), liveItemsOf(kanban(), filled))).toEqual(filled);
    expect(storedBoardOf(kanban(), liveItemsOf(kanban(), undefined))).toEqual(seed);
    const locked = liveItemsOf(kanban({ lockColumns: true }), filled) as KanbanLiveItem[];
    expect(locked.filter((i) => i.kind === "column").every((i) => i.kind === "column" && i.locked)).toBe(true);
  });

  it("compare kanban boards independent of the session's order keys", () => {
    const el = kanban();
    const fresh = liveItemsOf(el, filled) as KanbanLiveItem[];
    // move b before a and back again: other keys, same board
    const moved = applyKanbanOps(fresh, [moveCardOp(fresh, "b", "todo", 0)!]);
    const back = applyKanbanOps(moved, [moveCardOp(moved, "a", "todo", 0)!]);
    expect(back.find((i) => i.id === "a")).not.toEqual(fresh.find((i) => i.id === "a"));
    expect(canonicalBoard(el, back)).toEqual(canonicalBoard(el, fresh));
    expect(canonicalBoard(el, moved)).not.toEqual(canonicalBoard(el, fresh));
  });

  it("fall back to the template's columns when a session lost every column", () => {
    const items = kanbanToLiveItems(filled).filter((i) => i.kind === "card");
    expect(storedBoardOf(kanban(), items)).toEqual({ columns: [{ id: "todo", title: "Offen", cards: [{ id: "a", title: "A" }, { id: "b", title: "B" }] }, { id: "done", title: "Erledigt", cards: [] }] });
  });

  it("limit kanban cards and columns separately", () => {
    expect(liveLimits("kanban").perKind).toEqual({ card: 500, column: 20 });
    expect(liveLimits("whiteboard").perKind).toEqual({});
  });
});
