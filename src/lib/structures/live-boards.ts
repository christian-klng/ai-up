import type { KanbanBoard, StructureAnswerValue, StructureElement, WhiteboardBoard, WhiteboardItem } from "./types";
import { isKanbanBoard, isWhiteboardBoard } from "./types";
import { KANBAN_MAX_CARDS, KANBAN_MAX_COLUMNS, KANBAN_MAX_LIVE_ITEMS, kanbanToLiveItems, liveItemsToKanban, type KanbanLiveItem } from "./kanban";
import { WHITEBOARD_MAX_ITEMS } from "./whiteboard";

// ---------------------------------------------------------------------------
// Element types that are edited in a live session (docs/whiteboard.md 5,
// docs/kanban-board.md 5). The session layer (src/server/whiteboards/) only
// knows items with an id; this module translates between an element's stored
// answer and those items. Pure TS – shared by routes, actions and the worker.
// ---------------------------------------------------------------------------

/** What the session layer needs from an item; everything else is the element type's business. */
export type LiveItem = { id: string; kind?: string; locked?: boolean; createdBy?: string };

export type LiveBoardElement = Extract<StructureElement, { type: "whiteboard" | "kanban" }>;
export type LiveBoardKind = LiveBoardElement["type"];

export function isLiveBoardElement(el: StructureElement): el is LiveBoardElement {
  return el.type === "whiteboard" || el.type === "kanban";
}

/** Live boards are collaborative unless the template switches it off. */
export function isCollaborativeBoard(el: StructureElement): el is LiveBoardElement {
  return isLiveBoardElement(el) && el.collaborative !== false;
}

/** Items a session starts from: the stored answer, else the template seed. */
export function liveItemsOf(el: LiveBoardElement, value: StructureAnswerValue | undefined): LiveItem[] {
  if (el.type === "whiteboard") return isWhiteboardBoard(value) ? value.items : (el.seed?.items ?? []);
  return kanbanToLiveItems(isKanbanBoard(value) ? value : el.seed, { lockColumns: el.lockColumns });
}

/**
 * Session items → the answer that is saved. A kanban board that lost every column (two people
 * deleting the last two at once) falls back to the template's columns, so the save never fails.
 */
export function storedBoardOf(el: Extract<LiveBoardElement, { type: "kanban" }>, items: LiveItem[]): KanbanBoard;
export function storedBoardOf(el: LiveBoardElement, items: LiveItem[]): WhiteboardBoard | KanbanBoard;
export function storedBoardOf(el: LiveBoardElement, items: LiveItem[]): WhiteboardBoard | KanbanBoard {
  if (el.type === "whiteboard") return { items: items as WhiteboardItem[] };
  const board = liveItemsToKanban(items as KanbanLiveItem[]);
  if (board.columns.length > 0) return board;
  return liveItemsToKanban([...kanbanToLiveItems({ columns: el.seed.columns.map((c) => ({ ...c, cards: [] })) }), ...(items as KanbanLiveItem[])]);
}

/** Item limits the session enforces atomically: in total and per item kind. */
export function liveLimits(kind: LiveBoardKind): { maxItems: number; perKind: Record<string, number> } {
  if (kind === "whiteboard") return { maxItems: WHITEBOARD_MAX_ITEMS, perKind: {} };
  return { maxItems: KANBAN_MAX_LIVE_ITEMS, perKind: { card: KANBAN_MAX_CARDS, column: KANBAN_MAX_COLUMNS } };
}

/**
 * The form a board is compared in (did a write from outside change it?). Kanban compares the
 * stored form: order keys differ between sessions for the very same board.
 */
export function canonicalBoard(el: LiveBoardElement, items: LiveItem[]): unknown {
  if (el.type === "whiteboard") return items;
  return storedBoardOf(el, items);
}
