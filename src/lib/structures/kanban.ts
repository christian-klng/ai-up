import { z } from "zod";
import type { KanbanBoard, KanbanCard, KanbanColor, KanbanColumn } from "./types";
import { KANBAN_COLORS } from "./types";

// ---------------------------------------------------------------------------
// Kanban element (docs/kanban-board.md): schema, normalization, Markdown and
// the live form. Stored answers nest cards in columns (order = array position);
// a live session keeps columns and cards as flat items with an order key, so it
// can reuse the whiteboard's per-item session machinery (last writer wins per
// item). Pure TS – shared by the editor, server actions, MCP and the worker.
// ---------------------------------------------------------------------------

export const KANBAN_MAX_COLUMNS = 20;
export const KANBAN_MAX_CARDS = 500;
export const KANBAN_MAX_TITLE = 200;
export const KANBAN_MAX_COLUMN_TITLE = 100;
export const KANBAN_MAX_DESCRIPTION = 5000;
export const KANBAN_ID_REGEX = /^[A-Za-z0-9_-]{1,40}$/;

const idSchema = z.string().regex(KANBAN_ID_REGEX);

/** Input card – id may be left out (MCP/agents); blank cards are dropped on normalization. */
const kanbanCardInputSchema = z.object({
  id: idSchema.optional(),
  title: z.string().max(KANBAN_MAX_TITLE * 2),
  description: z.string().max(KANBAN_MAX_DESCRIPTION * 2).optional(),
  color: z.enum(KANBAN_COLORS).optional(),
});

const kanbanColumnInputSchema = z.object({
  id: idSchema.optional(),
  title: z.string().max(KANBAN_MAX_COLUMN_TITLE * 2),
  cards: z.array(kanbanCardInputSchema).max(KANBAN_MAX_CARDS).optional(),
});

export const kanbanBoardInputSchema = z.object({
  columns: z.array(kanbanColumnInputSchema).max(KANBAN_MAX_COLUMNS),
});

export type KanbanBoardInput = z.infer<typeof kanbanBoardInputSchema>;

/** Starting board for a new element. Titles come from the caller (translated in the editor). */
export function defaultKanbanSeed(titles: string[] = ["Offen", "In Arbeit", "Erledigt"]): KanbanBoard {
  return { columns: titles.map((title, i) => ({ id: `col${i + 1}`, title, cards: [] })) };
}

export function newKanbanId(): string {
  return `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Deterministic id for input without one – the same input yields the same board. */
function freeId(prefix: string, used: Set<string>): string {
  let n = 1;
  while (used.has(`${prefix}${n}`)) n++;
  const id = `${prefix}${n}`;
  used.add(id);
  return id;
}

function cleanText(value: string | undefined): string {
  return (value ?? "").replace(/\r\n?/g, "\n").trim();
}

export type KanbanNormalizeResult = { board: KanbanBoard; problems: string[] };

/**
 * Turns input into a stored board: trims text, drops blank cards, assigns missing ids and checks
 * limits. Ids share one namespace across columns and cards (a live session keeps both in one map).
 * With `lockedColumns` (template setting "lockColumns") the columns come from the template and
 * nothing else: cards are matched to them by column id, then by title; cards of any other column
 * land in the first one, so nothing is lost when the template changes.
 */
export function normalizeKanbanBoard(input: KanbanBoardInput, opts: { lockedColumns?: KanbanColumn[] } = {}): KanbanNormalizeResult {
  const problems: string[] = [];
  // locked column ids are taken from the start, so a generated card id never collides with one
  const used = new Set<string>((opts.lockedColumns ?? []).map((c) => c.id));
  const seen = new Set<string>();
  const claim = (id: string | undefined, what: string): string | undefined => {
    if (id === undefined) return undefined;
    if (seen.has(id)) problems.push(`duplicate ${what} id "${id}"`);
    seen.add(id);
    used.add(id);
    return id;
  };

  // pass 1: reserve every given id, so generated ids never collide with a later one
  const columnIds = input.columns.map((c) => claim(c.id, "column"));
  const cardIds = input.columns.map((c) => (c.cards ?? []).map((card) => claim(card.id, "card")));

  let columns: KanbanColumn[] = input.columns.map((col, ci) => {
    const title = cleanText(col.title);
    if (!title) problems.push(`column ${ci + 1} needs a title`);
    else if (title.length > KANBAN_MAX_COLUMN_TITLE) problems.push(`column "${title.slice(0, 40)}" title is too long`);
    const cards: KanbanCard[] = [];
    (col.cards ?? []).forEach((card, ki) => {
      const cardTitle = cleanText(card.title);
      const description = cleanText(card.description);
      if (!cardTitle && !description) return;
      if (!cardTitle) problems.push(`a card in column "${title}" needs a title`);
      else if (cardTitle.length > KANBAN_MAX_TITLE) problems.push(`card "${cardTitle.slice(0, 40)}" title is too long`);
      if (description.length > KANBAN_MAX_DESCRIPTION) problems.push(`card "${cardTitle.slice(0, 40)}" description is too long`);
      cards.push({
        id: cardIds[ci][ki] ?? freeId("card", used),
        title: cardTitle,
        ...(description ? { description } : {}),
        ...(card.color ? { color: card.color } : {}),
      });
    });
    return { id: columnIds[ci] ?? freeId("col", used), title, cards };
  });

  if (opts.lockedColumns) columns = lockToColumns(columns, input, opts.lockedColumns, used);

  if (columns.length === 0) problems.push("board needs at least one column");
  if (columns.length > KANBAN_MAX_COLUMNS) problems.push(`at most ${KANBAN_MAX_COLUMNS} columns`);
  const cardCount = columns.reduce((n, c) => n + c.cards.length, 0);
  if (cardCount > KANBAN_MAX_CARDS) problems.push(`at most ${KANBAN_MAX_CARDS} cards`);

  return { board: { columns }, problems };
}

function lockToColumns(columns: KanbanColumn[], input: KanbanBoardInput, locked: KanbanColumn[], used: Set<string>): KanbanColumn[] {
  const out: KanbanColumn[] = locked.map((c) => ({ id: c.id, title: c.title, cards: [] }));
  if (out.length === 0) return out;
  const byId = new Map(out.map((c) => [c.id, c]));
  const byTitle = new Map(out.map((c) => [c.title.toLowerCase(), c]));
  const lockedIds = new Set(out.map((c) => c.id));
  const leftovers: KanbanCard[] = [];
  columns.forEach((col, i) => {
    // an input column without an id is matched by title; a generated id must not match by accident
    const target = (input.columns[i]?.id !== undefined ? byId.get(col.id) : undefined) ?? byTitle.get(col.title.toLowerCase());
    // a card must not share its id with a locked column – give it a fresh one instead of dropping it
    const cards = col.cards.map((card) => (lockedIds.has(card.id) ? { ...card, id: freeId("card", used) } : card));
    if (target) target.cards.push(...cards);
    else leftovers.push(...cards);
  });
  out[0].cards.push(...leftovers);
  return out;
}

export function kanbanCardCount(board: KanbanBoard): number {
  return board.columns.reduce((n, c) => n + c.cards.length, 0);
}

/** Counts as answered once it holds a card – columns alone are scaffolding. */
export function kanbanHasContent(board: KanbanBoard): boolean {
  return board.columns.some((c) => c.cards.length > 0);
}

// ---------------------------------------------------------------------------
// Markdown: one heading per column, cards as a list. Colours as emoji keep the
// output free of translated words and still tell a reader (or an LLM) apart
// "red" from "green" cards.
// ---------------------------------------------------------------------------

export const KANBAN_COLOR_EMOJI: Record<KanbanColor, string> = {
  red: "🔴",
  orange: "🟠",
  yellow: "🟡",
  green: "🟢",
  blue: "🔵",
  purple: "🟣",
  brown: "🟤",
  gray: "⚪",
};

function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").trim();
}

/** Deterministic outline of a board; empty string when it holds no card. */
export function kanbanToMarkdown(board: KanbanBoard, level = 3): string {
  if (!kanbanHasContent(board)) return "";
  const hashes = "#".repeat(Math.min(6, level));
  return board.columns
    .map((col) => {
      const cards = col.cards.map((card) => {
        const head = `- ${card.color ? `${KANBAN_COLOR_EMOJI[card.color]} ` : ""}**${oneLine(card.title)}**`;
        if (!card.description) return head;
        const body = card.description
          .split("\n")
          .map((line) => (line.trim() ? `  ${line}` : ""))
          .join("\n");
        return `${head}\n\n${body}`;
      });
      return [`${hashes} ${oneLine(col.title)}`, ...(cards.length ? [cards.join("\n")] : [])].join("\n\n");
    })
    .join("\n\n");
}

/** Flat text for the search index. */
export function kanbanText(board: KanbanBoard): string {
  return board.columns
    .flatMap((col) => [col.title, ...col.cards.flatMap((card) => [card.title, card.description ?? ""])])
    .filter((s) => s.trim())
    .join(" ");
}

// ---------------------------------------------------------------------------
// Order keys: fractional strings over base-62 digits, compared as plain
// strings. A key never ends in the zero digit, so there is always room between
// two keys. Keys only live inside a session – saving turns them back into
// array positions, and loading hands out fresh, short keys.
// ---------------------------------------------------------------------------

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length;

/** What an order key from outside (a live op) must look like before it is compared or split. */
export const KANBAN_ORDER_REGEX = /^[0-9A-Za-z]{0,79}[1-9A-Za-z]$/;

function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? DIGITS[0]) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? DIGITS.indexOf(a[0]) : 0;
  const digitB = b !== null ? DIGITS.indexOf(b[0]) : BASE;
  if (digitB - digitA > 1) return DIGITS[Math.round((digitA + digitB) / 2)];
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[digitA] + midpoint(a.slice(1), null);
}

/** Appending walks one digit up instead of halving – keeps keys short when cards pile up at the end. */
function after(a: string): string {
  const last = DIGITS.indexOf(a[a.length - 1]);
  if (last < BASE - 1) return a.slice(0, -1) + DIGITS[last + 1];
  return a + DIGITS[BASE / 2];
}

function before(b: string): string {
  const last = DIGITS.indexOf(b[b.length - 1]);
  if (last > 1) return b.slice(0, -1) + DIGITS[last - 1];
  return b.slice(0, -1) + DIGITS[last - 1] + DIGITS[BASE / 2];
}

/** A key strictly between `a` and `b` (null = open end). Throws on a >= b. */
export function orderKeyBetween(a: string | null, b: string | null): string {
  if (a !== null && b !== null && a >= b) throw new Error(`order keys out of order: ${a} >= ${b}`);
  if (a === null && b === null) return DIGITS[BASE / 2];
  if (b === null) return after(a!);
  if (a === null) return before(b);
  return midpoint(a, b);
}

/** n ascending keys of equal width, spread evenly – what a freshly loaded session starts with. */
export function initialOrderKeys(n: number): string[] {
  if (n <= 0) return [];
  let width = 1;
  while (BASE ** width < 2 * (n + 1)) width++;
  const span = BASE ** width;
  const keys: string[] = [];
  for (let i = 0; i < n; i++) {
    let v = Math.round(((i + 1) * span) / (n + 1));
    if (v % BASE === 0) v++; // no trailing zero digit; the spacing (>= 2) keeps the order
    let s = "";
    for (let w = 0; w < width; w++) {
      s = DIGITS[v % BASE] + s;
      v = Math.floor(v / BASE);
    }
    keys.push(s);
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Live form and operations. An upsert always carries the whole item (last
// writer wins per item, like the whiteboard); a move is an upsert with a new
// columnId and order key, so two people moving different cards never clash.
// ---------------------------------------------------------------------------

export type KanbanLiveColumn = { id: string; kind: "column"; order: string; title: string; locked?: boolean; createdBy?: string };
export type KanbanLiveCard = { id: string; kind: "card"; order: string; columnId: string; title: string; description?: string; color?: KanbanColor; createdBy?: string };
export type KanbanLiveItem = KanbanLiveColumn | KanbanLiveCard;

export type KanbanOp = { op: "upsert"; item: KanbanLiveItem } | { op: "delete"; id: string };

/** A live item as it arrives from a client (the session layer stamps createdBy, the template alone sets locked). */
export const kanbanLiveItemSchema = z.discriminatedUnion("kind", [
  z.object({ id: idSchema, kind: z.literal("column"), order: z.string().regex(KANBAN_ORDER_REGEX), title: z.string().trim().min(1).max(KANBAN_MAX_COLUMN_TITLE) }),
  z.object({
    id: idSchema,
    kind: z.literal("card"),
    order: z.string().regex(KANBAN_ORDER_REGEX),
    columnId: idSchema,
    title: z.string().trim().min(1).max(KANBAN_MAX_TITLE),
    description: z.string().max(KANBAN_MAX_DESCRIPTION).optional(),
    color: z.enum(KANBAN_COLORS).optional(),
  }),
]);

/** Columns plus cards – the size of a live board in items. */
export const KANBAN_MAX_LIVE_ITEMS = KANBAN_MAX_COLUMNS + KANBAN_MAX_CARDS;

/** Stored board → live items. With `lockColumns` the columns are marked locked (the session rejects edits to them). */
export function kanbanToLiveItems(board: KanbanBoard, opts: { lockColumns?: boolean } = {}): KanbanLiveItem[] {
  const items: KanbanLiveItem[] = [];
  const columnKeys = initialOrderKeys(board.columns.length);
  board.columns.forEach((col, ci) => {
    items.push({ id: col.id, kind: "column", order: columnKeys[ci], title: col.title, ...(opts.lockColumns ? { locked: true } : {}) });
    const cardKeys = initialOrderKeys(col.cards.length);
    col.cards.forEach((card, ki) => {
      items.push({
        id: card.id,
        kind: "card",
        order: cardKeys[ki],
        columnId: col.id,
        title: card.title,
        ...(card.description ? { description: card.description } : {}),
        ...(card.color ? { color: card.color } : {}),
      });
    });
  });
  return items;
}

function byOrder(a: { order: string; id: string }, b: { order: string; id: string }): number {
  if (a.order !== b.order) return a.order < b.order ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function liveColumns(items: KanbanLiveItem[]): KanbanLiveColumn[] {
  return items.filter((i): i is KanbanLiveColumn => i.kind === "column").sort(byOrder);
}

/** Cards of a column in display order. */
export function liveCards(items: KanbanLiveItem[], columnId: string): KanbanLiveCard[] {
  return items.filter((i): i is KanbanLiveCard => i.kind === "card" && i.columnId === columnId).sort(byOrder);
}

/**
 * Live items → stored board. Cards whose column vanished (deleted by someone else meanwhile) land
 * at the end of the first column instead of being lost. Session-only fields (order, locked,
 * createdBy) are dropped.
 */
export function liveItemsToKanban(items: KanbanLiveItem[]): KanbanBoard {
  const columns = liveColumns(items);
  const known = new Set(columns.map((c) => c.id));
  const orphans = items.filter((i): i is KanbanLiveCard => i.kind === "card" && !known.has(i.columnId)).sort(byOrder);
  const toCard = (c: KanbanLiveCard): KanbanCard => ({ id: c.id, title: c.title, ...(c.description ? { description: c.description } : {}), ...(c.color ? { color: c.color } : {}) });
  return {
    columns: columns.map((col, i) => ({
      id: col.id,
      title: col.title,
      cards: [...liveCards(items, col.id), ...(i === 0 ? orphans : [])].map(toCard),
    })),
  };
}

export function applyKanbanOps(items: KanbanLiveItem[], ops: KanbanOp[]): KanbanLiveItem[] {
  if (ops.length === 0) return items;
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const op of ops) {
    if (op.op === "upsert") byId.set(op.item.id, op.item);
    else byId.delete(op.id);
  }
  return [...byId.values()];
}

/** Order key for position `index` within `siblings` (display order), ignoring `movingId` itself. */
function keyAt(siblings: Array<{ id: string; order: string }>, index: number, movingId?: string): string {
  const rest = siblings.filter((s) => s.id !== movingId);
  const i = Math.max(0, Math.min(index, rest.length));
  const prev = rest[i - 1]?.order ?? null;
  const next = rest[i]?.order ?? null;
  // equal keys (two people inserted at the same spot) leave no room – fall back to "just after prev"
  if (prev !== null && next !== null && prev >= next) return orderKeyBetween(prev, null);
  return orderKeyBetween(prev, next);
}

/** Adds a card at `index` in a column (default: at the end). */
export function addCardOp(items: KanbanLiveItem[], columnId: string, card: Omit<KanbanLiveCard, "kind" | "order" | "columnId">, index?: number): KanbanOp {
  const siblings = liveCards(items, columnId);
  return { op: "upsert", item: { ...card, kind: "card", columnId, order: keyAt(siblings, index ?? siblings.length) } };
}

/** Moves a card to `index` of a column (index counted without the card itself). Null if the card is gone. */
export function moveCardOp(items: KanbanLiveItem[], cardId: string, toColumnId: string, index: number): KanbanOp | null {
  const card = items.find((i): i is KanbanLiveCard => i.kind === "card" && i.id === cardId);
  if (!card) return null;
  return { op: "upsert", item: { ...card, columnId: toColumnId, order: keyAt(liveCards(items, toColumnId), index, cardId) } };
}

export function addColumnOp(items: KanbanLiveItem[], column: { id: string; title: string }, index?: number): KanbanOp {
  const siblings = liveColumns(items);
  return { op: "upsert", item: { ...column, kind: "column", order: keyAt(siblings, index ?? siblings.length) } };
}

export function moveColumnOp(items: KanbanLiveItem[], columnId: string, index: number): KanbanOp | null {
  const column = items.find((i): i is KanbanLiveColumn => i.kind === "column" && i.id === columnId);
  if (!column) return null;
  return { op: "upsert", item: { ...column, order: keyAt(liveColumns(items), index, columnId) } };
}

/** Only empty columns can go, and never the last one. Null otherwise. */
export function deleteColumnOp(items: KanbanLiveItem[], columnId: string): KanbanOp | null {
  if (liveColumns(items).length <= 1 || liveCards(items, columnId).length > 0) return null;
  return { op: "delete", id: columnId };
}

// ---------------------------------------------------------------------------
// Intents: how MCP and agents change a board – by id or title, with positions
// instead of order keys. Translated into ops against the current items, one
// after another, so a later intent sees what an earlier one did (add a column,
// then cards into it).
// ---------------------------------------------------------------------------

const refSchema = z.string().trim().min(1).max(KANBAN_MAX_TITLE).describe("id, or the exact title (case-insensitive, must be unique)");
const positionSchema = z.number().int().min(0).max(KANBAN_MAX_CARDS).optional().describe("0-based position; default: at the end");

export const kanbanIntentSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("addCard"), column: refSchema, title: z.string().trim().min(1).max(KANBAN_MAX_TITLE), description: z.string().max(KANBAN_MAX_DESCRIPTION).optional().describe("markdown"), color: z.enum(KANBAN_COLORS).optional(), position: positionSchema }),
  z.object({
    op: z.literal("updateCard"),
    card: refSchema,
    title: z.string().trim().min(1).max(KANBAN_MAX_TITLE).optional(),
    description: z.string().max(KANBAN_MAX_DESCRIPTION).nullable().optional().describe("markdown; null removes it"),
    color: z.enum(KANBAN_COLORS).nullable().optional().describe("null removes it"),
  }),
  z.object({ op: z.literal("moveCard"), card: refSchema, column: refSchema, position: positionSchema }),
  z.object({ op: z.literal("deleteCard"), card: refSchema }),
  z.object({ op: z.literal("addColumn"), title: z.string().trim().min(1).max(KANBAN_MAX_COLUMN_TITLE), position: positionSchema }),
  z.object({ op: z.literal("renameColumn"), column: refSchema, title: z.string().trim().min(1).max(KANBAN_MAX_COLUMN_TITLE) }),
  z.object({ op: z.literal("moveColumn"), column: refSchema, position: z.number().int().min(0).max(KANBAN_MAX_COLUMNS) }),
  z.object({ op: z.literal("deleteColumn"), column: refSchema }),
]);

export type KanbanIntent = z.infer<typeof kanbanIntentSchema>;
/** Per intent: the id it touched, or why it was skipped. */
export type KanbanIntentResult = { ok: true; id: string } | { ok: false; error: string };

type Found<T> = { item: T } | { error: string };

function findByRef<T extends KanbanLiveItem>(candidates: T[], ref: string, what: "card" | "column"): Found<T> {
  const byId = candidates.find((c) => c.id === ref);
  if (byId) return { item: byId };
  const needle = ref.trim().toLowerCase();
  const byTitle = candidates.filter((c) => c.title.trim().toLowerCase() === needle);
  if (byTitle.length === 1) return { item: byTitle[0] };
  if (byTitle.length > 1) return { error: `${byTitle.length} ${what}s are titled "${ref}" – use the id (${byTitle.map((c) => c.id).join(", ")})` };
  return { error: `no ${what} "${ref}"` };
}

/**
 * Translates intents into ops against `items`. Skipped intents (unknown reference, limits, fixed
 * columns) do not stop the rest; the result says per intent what happened. Returns the items as
 * they are after the applied ops.
 */
export function translateKanbanIntents(items: KanbanLiveItem[], intents: KanbanIntent[], opts: { lockColumns?: boolean } = {}): { ops: KanbanOp[]; items: KanbanLiveItem[]; results: KanbanIntentResult[] } {
  let cur = items;
  const ops: KanbanOp[] = [];
  const results: KanbanIntentResult[] = [];
  const cards = () => cur.filter((i): i is KanbanLiveCard => i.kind === "card");
  const push = (op: KanbanOp | null, id: string, failure: string) => {
    if (!op) {
      results.push({ ok: false, error: failure });
      return;
    }
    ops.push(op);
    cur = applyKanbanOps(cur, [op]);
    results.push({ ok: true, id });
  };
  const fixedColumns = "the columns are fixed by the template – only cards can change";

  for (const intent of intents) {
    switch (intent.op) {
      case "addCard": {
        const col = findByRef(liveColumns(cur), intent.column, "column");
        if ("error" in col) {
          results.push({ ok: false, error: col.error });
          break;
        }
        if (cards().length >= KANBAN_MAX_CARDS) {
          results.push({ ok: false, error: `the board holds at most ${KANBAN_MAX_CARDS} cards` });
          break;
        }
        const id = newKanbanId();
        const description = intent.description?.replace(/\r\n?/g, "\n").trim();
        push(addCardOp(cur, col.item.id, { id, title: intent.title, ...(description ? { description } : {}), ...(intent.color ? { color: intent.color } : {}) }, intent.position), id, "");
        break;
      }
      case "updateCard": {
        const card = findByRef(cards(), intent.card, "card");
        if ("error" in card) {
          results.push({ ok: false, error: card.error });
          break;
        }
        const next: KanbanLiveCard = { ...card.item };
        if (intent.title !== undefined) next.title = intent.title;
        if (intent.description !== undefined) {
          const description = intent.description?.replace(/\r\n?/g, "\n").trim();
          if (description) next.description = description;
          else delete next.description;
        }
        if (intent.color !== undefined) {
          if (intent.color) next.color = intent.color;
          else delete next.color;
        }
        push({ op: "upsert", item: next }, next.id, "");
        break;
      }
      case "moveCard": {
        const card = findByRef(cards(), intent.card, "card");
        const col = findByRef(liveColumns(cur), intent.column, "column");
        if ("error" in card || "error" in col) {
          results.push({ ok: false, error: "error" in card ? card.error : (col as { error: string }).error });
          break;
        }
        const others = liveCards(cur, col.item.id).filter((c) => c.id !== card.item.id).length;
        push(moveCardOp(cur, card.item.id, col.item.id, intent.position ?? others), card.item.id, `no card "${intent.card}"`);
        break;
      }
      case "deleteCard": {
        const card = findByRef(cards(), intent.card, "card");
        if ("error" in card) results.push({ ok: false, error: card.error });
        else push({ op: "delete", id: card.item.id }, card.item.id, "");
        break;
      }
      case "addColumn": {
        if (opts.lockColumns) results.push({ ok: false, error: fixedColumns });
        else if (liveColumns(cur).length >= KANBAN_MAX_COLUMNS) results.push({ ok: false, error: `the board holds at most ${KANBAN_MAX_COLUMNS} columns` });
        else {
          const id = newKanbanId();
          push(addColumnOp(cur, { id, title: intent.title }, intent.position), id, "");
        }
        break;
      }
      case "renameColumn":
      case "moveColumn":
      case "deleteColumn": {
        if (opts.lockColumns) {
          results.push({ ok: false, error: fixedColumns });
          break;
        }
        const col = findByRef(liveColumns(cur), intent.column, "column");
        if ("error" in col) {
          results.push({ ok: false, error: col.error });
          break;
        }
        if (intent.op === "renameColumn") push({ op: "upsert", item: { ...col.item, title: intent.title } }, col.item.id, "");
        else if (intent.op === "moveColumn") push(moveColumnOp(cur, col.item.id, intent.position), col.item.id, "");
        else push(deleteColumnOp(cur, col.item.id), col.item.id, `column "${col.item.title}" still holds cards (or is the last one) – move or delete its cards first`);
        break;
      }
    }
  }
  return { ops, items: cur, results };
}
