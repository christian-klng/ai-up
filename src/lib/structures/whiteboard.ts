import { z } from "zod";
import type { StructureAnswers, StructureDefinition, WhiteboardBoard, WhiteboardItem } from "./types";
import { WHITEBOARD_COLORS, isWhiteboardBoard } from "./types";

// ---------------------------------------------------------------------------
// Whiteboard element: schema, normalization and the deterministic text
// rendering. Pure TS – shared by the editor, server actions, MCP, the live
// session endpoints and the worker.
// ---------------------------------------------------------------------------

export const WHITEBOARD_MAX_ITEMS = 500;
export const WHITEBOARD_MAX_TEXT = 2000;
export const WHITEBOARD_COORD_LIMIT = 100_000;
export const WHITEBOARD_MIN_SIZE = 20;
export const WHITEBOARD_MAX_SIZE = 4000;
export const WHITEBOARD_ID_REGEX = /^[A-Za-z0-9_-]{1,40}$/;

/** Default sizes per kind – also used when MCP/agents omit them. */
export const WHITEBOARD_DEFAULT_SIZE: Record<WhiteboardItem["kind"], { w: number; h: number }> = {
  sticky: { w: 200, h: 200 },
  text: { w: 320, h: 60 },
  shape: { w: 480, h: 360 },
  image: { w: 320, h: 240 },
};

const coord = z.number().finite().min(-WHITEBOARD_COORD_LIMIT).max(WHITEBOARD_COORD_LIMIT);
const size = z.number().finite().min(WHITEBOARD_MIN_SIZE).max(WHITEBOARD_MAX_SIZE);

/** Stored item – every geometry field present. */
export const whiteboardItemSchema = z.object({
  id: z.string().regex(WHITEBOARD_ID_REGEX),
  kind: z.enum(["sticky", "text", "shape", "image"]),
  x: coord,
  y: coord,
  w: size,
  h: size,
  z: z.number().int().min(-1_000_000).max(1_000_000),
  text: z.string().max(WHITEBOARD_MAX_TEXT).optional(),
  color: z.enum(WHITEBOARD_COLORS).optional(),
  shape: z.enum(["rect", "ellipse"]).optional(),
  fontSize: z.enum(["s", "m", "l", "xl"]).optional(),
  mediaId: z.string().uuid().optional(),
  url: z.string().url().max(2000).optional(),
  alt: z.string().max(500).optional(),
  locked: z.boolean().optional(),
  createdBy: z.string().min(1).max(64).optional(),
});

/** Input item – geometry may be left out (MCP/agents); `layoutMissingItems` fills it in. */
export const whiteboardItemInputSchema = whiteboardItemSchema.extend({
  x: coord.optional(),
  y: coord.optional(),
  w: size.optional(),
  h: size.optional(),
  z: z.number().int().min(-1_000_000).max(1_000_000).optional(),
});

export const whiteboardBoardSchema = z.object({ items: z.array(whiteboardItemSchema).max(WHITEBOARD_MAX_ITEMS) });
export const whiteboardBoardInputSchema = z.object({ items: z.array(whiteboardItemInputSchema).max(WHITEBOARD_MAX_ITEMS) });

export type WhiteboardItemInput = z.infer<typeof whiteboardItemInputSchema>;

/** Per-item checks the schema cannot express. Returns a message or null. */
export function whiteboardItemProblem(item: Pick<WhiteboardItem, "kind" | "mediaId" | "url">): string | null {
  if (item.kind === "image") {
    if (!item.mediaId && !item.url) return "image item needs mediaId or url";
    if (item.mediaId && item.url) return "image item takes either mediaId or url, not both";
    if (item.url && !/^https?:\/\//i.test(item.url)) return "image url must be http(s)";
  } else if (item.mediaId || item.url) {
    return "only image items carry mediaId/url";
  }
  return null;
}

/** Messages for duplicate ids and per-item problems (definition seed and answers share this). */
export function whiteboardProblems(board: { items: Array<Pick<WhiteboardItem, "id" | "kind" | "mediaId" | "url">> }): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const item of board.items) {
    if (ids.has(item.id)) problems.push(`duplicate item id "${item.id}"`);
    ids.add(item.id);
    const p = whiteboardItemProblem(item);
    if (p) problems.push(`${item.id}: ${p}`);
  }
  return problems;
}

const GRID_GAP = 40;
const GRID_COLUMNS = 4;

/**
 * Places items without coordinates in a grid below the existing content (LLMs place badly).
 * Deterministic: the order of the input decides the grid slot. Sizes default per kind,
 * z continues above the highest existing item.
 */
export function layoutMissingItems(items: WhiteboardItemInput[]): WhiteboardItem[] {
  const placed = items.filter((i) => i.x !== undefined && i.y !== undefined);
  const bottom = placed.reduce((m, i) => Math.max(m, (i.y ?? 0) + (i.h ?? WHITEBOARD_DEFAULT_SIZE[i.kind].h)), placed.length ? -Infinity : 0);
  const left = placed.length ? placed.reduce((m, i) => Math.min(m, i.x ?? 0), Infinity) : 0;
  let z = items.reduce((m, i) => (i.z !== undefined ? Math.max(m, i.z) : m), 0);
  const startY = placed.length ? bottom + GRID_GAP * 2 : 0;
  let slot = 0;
  let rowHeight = 0;
  let cursorX = left;
  let cursorY = startY;
  return items.map((i) => {
    const def = WHITEBOARD_DEFAULT_SIZE[i.kind];
    const w = i.w ?? def.w;
    const h = i.h ?? def.h;
    const itemZ = i.z ?? ++z;
    if (i.x !== undefined && i.y !== undefined) return { ...i, x: i.x, y: i.y, w, h, z: itemZ };
    if (slot > 0 && slot % GRID_COLUMNS === 0) {
      cursorX = left;
      cursorY += rowHeight + GRID_GAP;
      rowHeight = 0;
    }
    const out = { ...i, x: cursorX, y: cursorY, w, h, z: itemZ };
    cursorX += w + GRID_GAP;
    rowHeight = Math.max(rowHeight, h);
    slot++;
    return out;
  });
}

/**
 * Locked items come from the template seed and nothing else: input copies of them are dropped and
 * the seed's versions put back, so a member (or an API caller) cannot move, edit or delete them –
 * and nobody but the template can add locked items.
 */
export function enforceSeedLocks(seed: WhiteboardBoard | undefined, items: WhiteboardItem[]): WhiteboardItem[] {
  const locked = (seed?.items ?? []).filter((i) => i.locked);
  const lockedIds = new Set(locked.map((i) => i.id));
  const own = items.filter((i) => !lockedIds.has(i.id)).map((i) => (i.locked ? { ...i, locked: undefined } : i));
  return [...locked.map((i) => structuredClone(i)), ...own].map(stripUndefined);
}

function stripUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

/**
 * Authorship is server-side truth: an item that existed before keeps its author, a new one gets the
 * actor (or none when no actor is known, e.g. a workflow without a user).
 */
export function stampWhiteboardAuthors(def: StructureDefinition, answers: StructureAnswers, prevAnswers: StructureAnswers | undefined, actorId: string | undefined, trustedKeys: string[] = []): StructureAnswers {
  const out = { ...answers };
  for (const el of def.elements) {
    // trusted: a live session stamped the authors itself, per op (src/server/whiteboards/state.ts)
    if (el.type !== "whiteboard" || trustedKeys.includes(el.key)) continue;
    const board = out[el.key];
    if (!isWhiteboardBoard(board)) continue;
    const prev = prevAnswers?.[el.key];
    const prevAuthors = new Map((isWhiteboardBoard(prev) ? prev.items : []).map((i) => [i.id, i.createdBy]));
    const seedIds = new Set((el.seed?.items ?? []).map((i) => i.id));
    out[el.key] = {
      items: board.items.map((i) => {
        if (i.locked || seedIds.has(i.id)) return stripUndefined({ ...i, createdBy: undefined });
        const createdBy = prevAuthors.has(i.id) ? prevAuthors.get(i.id) : actorId;
        return stripUndefined({ ...i, createdBy });
      }),
    };
  }
  return out;
}

/** Counts as answered once it holds an own (non-locked) item with text or an image. */
export function whiteboardHasContent(board: WhiteboardBoard): boolean {
  return board.items.some((i) => !i.locked && (i.kind === "image" ? Boolean(i.mediaId || i.url) : Boolean(i.text?.trim())));
}

// ---------------------------------------------------------------------------
// Markdown: boxes are groups, reading order top-left to bottom-right.
// ---------------------------------------------------------------------------

/** Items whose top edges are closer than this count as one row. */
const ROW_TOLERANCE = 40;
const MAX_GROUP_DEPTH = 3;

function readingOrder(a: WhiteboardItem, b: WhiteboardItem): number {
  if (Math.abs(a.y - b.y) >= ROW_TOLERANCE) return a.y - b.y;
  if (a.x !== b.x) return a.x - b.x;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function contains(box: WhiteboardItem, item: WhiteboardItem): boolean {
  const cx = item.x + item.w / 2;
  const cy = item.y + item.h / 2;
  return cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h;
}

/** The smallest shape containing the item's centre (a shape never contains itself or a larger shape). */
function parentOf(item: WhiteboardItem, shapes: WhiteboardItem[]): WhiteboardItem | undefined {
  let best: WhiteboardItem | undefined;
  for (const s of shapes) {
    if (s.id === item.id) continue;
    if (s.w * s.h <= item.w * item.h && item.kind === "shape") continue;
    if (!contains(s, item)) continue;
    if (!best || s.w * s.h < best.w * best.h) best = s;
  }
  return best;
}

function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, " / ").trim();
}

function leafLine(item: WhiteboardItem): string | null {
  if (item.kind === "image") {
    const src = item.mediaId ? `/api/files/${item.mediaId}` : item.url;
    if (!src) return null;
    return `- ![${oneLine(item.alt ?? "")}](${src})`;
  }
  const text = item.text?.trim();
  return text ? `- ${oneLine(text)}` : null;
}

/**
 * Deterministic outline of a board: free items first (no heading, so the renderer needs no
 * translated text), then one heading per box with its content. Empty items are skipped.
 */
export function whiteboardToMarkdown(board: WhiteboardBoard, level = 3): string {
  const items = [...board.items].sort(readingOrder);
  const shapes = items.filter((i) => i.kind === "shape");
  const parent = new Map(items.map((i) => [i.id, parentOf(i, shapes)?.id]));
  const children = (parentId: string | undefined) => items.filter((i) => parent.get(i.id) === parentId);

  const render = (parentId: string | undefined, depth: number): string[] => {
    const leaves: string[] = [];
    const groups: string[] = [];
    for (const item of children(parentId)) {
      if (item.kind !== "shape") {
        const line = leafLine(item);
        if (line) leaves.push(line);
        continue;
      }
      const inner = render(item.id, depth + 1);
      const title = item.text?.trim() ? oneLine(item.text) : "";
      if (depth >= MAX_GROUP_DEPTH || (!title && inner.length === 0)) {
        // too deep for another heading (or an empty unlabeled box): flatten into the parent
        if (title) leaves.push(`- ${title}`);
        leaves.push(...inner.join("\n").split("\n").filter((l) => l.startsWith("- ")));
        continue;
      }
      const heading = title ? `${"#".repeat(Math.min(6, level + depth))} ${title}` : null;
      groups.push([heading, inner.join("\n")].filter(Boolean).join("\n\n"));
    }
    const parts: string[] = [];
    if (leaves.length) parts.push(leaves.join("\n"));
    parts.push(...groups.filter((g) => g.trim()));
    return parts.length ? [parts.join("\n\n")] : [];
  };

  return render(undefined, 0).join("\n\n").trim();
}

/** Flat text for the search index. */
export function whiteboardText(board: WhiteboardBoard): string {
  return [...board.items]
    .sort(readingOrder)
    .map((i) => [i.text, i.alt].filter(Boolean).join(" "))
    .filter((s) => s.trim())
    .join(" ");
}

// ---------------------------------------------------------------------------
// Operations: the editor speaks in ops, whether it edits a form value locally
// or a live session. An upsert always carries the whole item (last writer wins
// per item – see docs/whiteboard.md 5.2).
// ---------------------------------------------------------------------------

export type WhiteboardOp = { op: "upsert"; item: WhiteboardItem } | { op: "delete"; id: string };

export function applyWhiteboardOps(items: WhiteboardItem[], ops: WhiteboardOp[]): WhiteboardItem[] {
  if (ops.length === 0) return items;
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const op of ops) {
    if (op.op === "upsert") byId.set(op.item.id, op.item);
    else byId.delete(op.id);
  }
  return [...byId.values()];
}

/** Next free z above everything on the board. */
export function nextZ(items: WhiteboardItem[]): number {
  return items.reduce((m, i) => Math.max(m, i.z), 0) + 1;
}

export function newWhiteboardItemId(): string {
  return `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
