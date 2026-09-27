import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getRedis } from "@/server/redis";
import { env } from "@/server/env";
import { logger } from "@/server/logger";
import { CHANNEL_PREFIX } from "@/server/realtime/publish";
import type { StructureAnswers, StructureDefinition } from "@/lib/structures/types";
import { canonicalBoard, isLiveBoardElement, liveItemsOf, type LiveBoardElement, type LiveBoardKind, type LiveItem } from "@/lib/structures/live-boards";
import type { LiveOp, WhiteboardEvent, WhiteboardParticipant } from "@/lib/whiteboard-live";

// ---------------------------------------------------------------------------
// Live state of a board session in Redis (docs/whiteboard.md 5) – whiteboards
// and kanban boards alike (src/lib/structures/live-boards.ts translates). The
// database only sees a version when the session is saved (flush.ts). Every
// state change runs as one Lua script that also publishes the event, so the
// channel order is the seq order. No next/* – the worker flushes from here too.
// ---------------------------------------------------------------------------

/** Keys and state expire when a board is left alone for this long (safety net, flush comes first). */
const STATE_TTL_S = 60 * 60 * 24;
/** Soft lock while someone types in an item. */
export const LOCK_MS = 30_000;
/** A connection without heartbeat for this long no longer counts as present. */
const PRESENCE_STALE_MS = 45_000;

export type BoardRef = { contentId: string; key: string };

const base = (b: BoardRef) => `aiup:wb:${b.contentId}:${b.key}`;
const keys = (b: BoardRef) => ({
  items: `${base(b)}:items`,
  seq: `${base(b)}:seq`,
  meta: `${base(b)}:meta`,
  contrib: `${base(b)}:contrib`,
  loaded: `${base(b)}:loaded`,
  locks: `${base(b)}:locks`,
  presence: `${base(b)}:presence`,
  sel: `${base(b)}:sel`,
});
export const boardChannel = (b: BoardRef) => `${CHANNEL_PREFIX}wb:${b.contentId}:${b.key}`;

function allKeys(b: BoardRef): string[] {
  return Object.values(keys(b));
}

/** Content hash of whiteboard items (order-independent). */
export function boardHash(items: LiveItem[]): string {
  const sorted = [...items].sort((a, b) => (a.id < b.id ? -1 : 1)).map((i) => Object.fromEntries(Object.entries(i).sort(([x], [y]) => (x < y ? -1 : 1))));
  return createHash("sha1").update(JSON.stringify(sorted)).digest("hex");
}

/** Content hash of a board in its canonical form – tells whether a later write actually changed it (see `resetLiveBoard`). */
export function liveHash(el: LiveBoardElement, items: LiveItem[]): string {
  if (el.type === "whiteboard") return boardHash(items);
  return createHash("sha1").update(JSON.stringify(canonicalBoard(el, items))).digest("hex");
}

// Lua: KEYS = items, seq, meta, loaded, contrib, locks, sel (+ presence where noted); cjson ships with Redis.

const INIT = `
if redis.call('EXISTS', KEYS[4]) == 1 then return 0 end
local items = cjson.decode(ARGV[1])
for _, item in ipairs(items) do redis.call('HSET', KEYS[1], item.id, cjson.encode(item)) end
redis.call('SET', KEYS[2], 0)
redis.call('HSET', KEYS[3], 'communityId', ARGV[2], 'base', ARGV[3], 'flushedSeq', 0)
redis.call('SET', KEYS[4], 1)
for i = 1, #KEYS do redis.call('EXPIRE', KEYS[i], tonumber(ARGV[4])) end
return 1
`;

const APPLY = `
if redis.call('EXISTS', KEYS[4]) == 0 then return '{"missing":true}' end
local user, maxItems, now, ttl = ARGV[1], tonumber(ARGV[2]), tonumber(ARGV[3]), tonumber(ARGV[4])
local ops = cjson.decode(ARGV[5])
local perKind = cjson.decode(ARGV[9])
local applied, rejected = {}, {}
for _, op in ipairs(ops) do
  local id = op.op == 'upsert' and op.item.id or op.id
  local raw = redis.call('HGET', KEYS[1], id)
  local cur = raw and cjson.decode(raw) or nil
  local ok = not (cur and cur.locked == true)
  local lock = redis.call('HGET', KEYS[6], id)
  if ok and lock then
    local owner, untilMs = string.match(lock, '^(.*)|(%d+)$')
    if tonumber(untilMs) > now and owner ~= user then ok = false end
    if owner == user then redis.call('HSET', KEYS[6], id, user .. '|' .. (now + tonumber(ARGV[7]))) end
  end
  if ok and op.op == 'upsert' then
    if op.item.locked == true then ok = false end
    if ok and not cur and redis.call('HLEN', KEYS[1]) >= maxItems then ok = false end
    local limit = ok and not cur and op.item.kind and perKind[op.item.kind]
    if limit then
      -- only new items of a limited kind pay for the count (kanban: cards, columns)
      local n = 0
      for _, other in ipairs(redis.call('HVALS', KEYS[1])) do
        if cjson.decode(other).kind == op.item.kind then n = n + 1 end
      end
      if n >= limit then ok = false end
    end
  end
  if ok then
    if op.op == 'upsert' then
      local item = op.item
      if cur then item.createdBy = cur.createdBy else item.createdBy = user end
      redis.call('HSET', KEYS[1], id, cjson.encode(item))
      table.insert(applied, { op = 'upsert', item = item })
    else
      redis.call('HDEL', KEYS[1], id)
      redis.call('HDEL', KEYS[6], id)
      table.insert(applied, { op = 'delete', id = id })
    end
  else
    table.insert(rejected, id)
  end
end
local seq = tonumber(redis.call('GET', KEYS[2]))
local became = 0
if #applied > 0 then
  seq = redis.call('INCR', KEYS[2])
  redis.call('HSET', KEYS[3], 'lastBy', user, 'lastAt', now)
  became = redis.call('HSETNX', KEYS[3], 'dirtySince', now)
  redis.call('SADD', KEYS[5], user)
  redis.call('PUBLISH', ARGV[6], cjson.encode({ t = 'ops', seq = seq, by = user, clientId = ARGV[8], ops = applied }))
  for i = 1, #KEYS do redis.call('EXPIRE', KEYS[i], ttl) end
end
return cjson.encode({ seq = seq, rejected = rejected, becameDirty = became == 1 })
`;

const RESET = `
if redis.call('EXISTS', KEYS[4]) == 0 then return 0 end
redis.call('DEL', KEYS[1], KEYS[5], KEYS[6])
local items = cjson.decode(ARGV[1])
for _, item in ipairs(items) do redis.call('HSET', KEYS[1], item.id, cjson.encode(item)) end
local seq = redis.call('INCR', KEYS[2])
redis.call('HSET', KEYS[3], 'base', ARGV[2], 'flushedSeq', seq)
redis.call('HDEL', KEYS[3], 'dirtySince')
redis.call('PUBLISH', ARGV[3], cjson.encode({ t = 'reset', seq = seq, items = items }))
return seq
`;

/** After a flush: remember what was saved; clear the dirty marks only if nothing changed meanwhile. */
const MARK_FLUSHED = `
redis.call('HSET', KEYS[3], 'flushedSeq', ARGV[1], 'base', ARGV[2])
if tonumber(redis.call('GET', KEYS[2]) or '0') == tonumber(ARGV[1]) then
  redis.call('HDEL', KEYS[3], 'dirtySince')
  redis.call('DEL', KEYS[5])
  return 1
end
return 0
`;

/** Drops the whole state if it is still at the given seq and nobody is connected. */
const DROP_IF = `
if tonumber(redis.call('GET', KEYS[2]) or '0') ~= tonumber(ARGV[1]) then return 0 end
if redis.call('HLEN', KEYS[8]) > 0 then return 0 end
for i = 1, #KEYS do redis.call('DEL', KEYS[i]) end
return 1
`;

function orderedKeys(b: BoardRef): string[] {
  const k = keys(b);
  return [k.items, k.seq, k.meta, k.loaded, k.contrib, k.locks, k.sel, k.presence];
}

async function publish(b: BoardRef, event: WhiteboardEvent): Promise<void> {
  try {
    await getRedis().publish(boardChannel(b), JSON.stringify(event));
  } catch (err) {
    logger.warn({ err, type: event.t }, "whiteboard publish failed");
  }
}

export async function isLoaded(b: BoardRef): Promise<boolean> {
  return (await getRedis().exists(keys(b).loaded)) === 1;
}

/** Seeds the live state from the stored board, unless a session already holds it. `hash`: `liveHash` of the items. */
export async function ensureLoaded(b: BoardRef, communityId: string, items: LiveItem[], hash: string): Promise<void> {
  await getRedis().eval(INIT, 7, ...orderedKeys(b).slice(0, 7), JSON.stringify(items), communityId, hash, STATE_TTL_S);
}

export type BoardState = {
  seq: number;
  items: LiveItem[];
  communityId: string | null;
  lastBy: string | null;
  /** time of the last applied op */
  lastAt: number | null;
  /** first unsaved change; null = saved */
  dirtySince: number | null;
  flushedSeq: number;
  base: string | null;
  contributors: string[];
};

export async function readState(b: BoardRef): Promise<BoardState | null> {
  const k = keys(b);
  const res = await getRedis().multi().exists(k.loaded).get(k.seq).hgetall(k.items).hgetall(k.meta).smembers(k.contrib).exec();
  if (!res || res[0][1] !== 1) return null;
  const itemsRaw = (res[2][1] ?? {}) as Record<string, string>;
  const meta = (res[3][1] ?? {}) as Record<string, string>;
  return {
    seq: Number(res[1][1] ?? 0),
    items: Object.values(itemsRaw).map((s) => JSON.parse(s) as LiveItem),
    communityId: meta.communityId ?? null,
    lastBy: meta.lastBy ?? null,
    lastAt: meta.lastAt ? Number(meta.lastAt) : null,
    dirtySince: meta.dirtySince ? Number(meta.dirtySince) : null,
    flushedSeq: Number(meta.flushedSeq ?? 0),
    base: meta.base ?? null,
    contributors: (res[4][1] ?? []) as string[],
  };
}

export type ApplyResult = { missing: true } | { missing?: false; seq: number; rejected: string[]; becameDirty: boolean };

/** Applies a batch atomically (locks, item limits, authorship) and publishes it with its seq. Limits: `liveLimits`. */
export async function applyOps(b: BoardRef, userId: string, clientId: string, ops: LiveOp<LiveItem>[], limits: { maxItems: number; perKind: Record<string, number> }): Promise<ApplyResult> {
  const raw = (await getRedis().eval(APPLY, 7, ...orderedKeys(b).slice(0, 7), userId, limits.maxItems, Date.now(), STATE_TTL_S, JSON.stringify(ops), boardChannel(b), LOCK_MS, clientId, JSON.stringify(limits.perKind))) as string;
  const parsed = JSON.parse(raw) as { missing?: boolean; seq?: number; rejected?: string[] | Record<string, never>; becameDirty?: boolean };
  if (parsed.missing) return { missing: true };
  // cjson encodes an empty table as {} – normalize
  return { seq: parsed.seq ?? 0, rejected: Array.isArray(parsed.rejected) ? parsed.rejected : [], becameDirty: Boolean(parsed.becameDirty) };
}

/**
 * Replaces the live board after a write from outside the session (restore, MCP, agent, form).
 * Skipped when the written board is the one the session started from – then the writer did not
 * touch the board (e.g. a title-only edit) and the unsaved live changes must survive.
 */
export async function resetLiveBoard(b: BoardRef, items: LiveItem[], hash: string): Promise<"reset" | "kept" | "none"> {
  const r = getRedis();
  const k = keys(b);
  const [loaded, currentBase] = await Promise.all([r.exists(k.loaded), r.hget(k.meta, "base")]);
  if (!loaded) return "none";
  if (hash === currentBase) return "kept";
  await r.eval(RESET, 7, ...orderedKeys(b).slice(0, 7), JSON.stringify(items), hash, boardChannel(b));
  return "reset";
}

/** `hash`: `liveHash` of what was saved. */
export async function markFlushed(b: BoardRef, seq: number, hash: string): Promise<boolean> {
  return (await getRedis().eval(MARK_FLUSHED, 7, ...orderedKeys(b).slice(0, 7), seq, hash)) === 1;
}

export async function dropStateIf(b: BoardRef, seq: number): Promise<boolean> {
  return (await getRedis().eval(DROP_IF, 8, ...orderedKeys(b), seq)) === 1;
}

export async function dropState(b: BoardRef): Promise<void> {
  await getRedis().del(...allKeys(b));
}

// ---------------------------------------------------------------------------
// Presence, selections, soft locks – ephemeral, never saved.
// ---------------------------------------------------------------------------

type PresenceEntry = { userId: string; name: string; avatarMediaId: string | null; at: number };

export async function participants(b: BoardRef): Promise<WhiteboardParticipant[]> {
  const k = keys(b);
  const [presence, sel] = await Promise.all([getRedis().hgetall(k.presence), getRedis().hgetall(k.sel)]);
  const now = Date.now();
  const byUser = new Map<string, WhiteboardParticipant>();
  const stale: string[] = [];
  for (const [connId, raw] of Object.entries(presence)) {
    const e = JSON.parse(raw) as PresenceEntry;
    if (now - e.at > PRESENCE_STALE_MS) {
      stale.push(connId);
      continue;
    }
    if (!byUser.has(e.userId)) byUser.set(e.userId, { userId: e.userId, name: e.name, avatarMediaId: e.avatarMediaId, selection: sel[e.userId] ? (JSON.parse(sel[e.userId]) as string[]) : [] });
  }
  if (stale.length) await getRedis().hdel(k.presence, ...stale);
  return [...byUser.values()];
}

async function publishPresence(b: BoardRef): Promise<WhiteboardParticipant[]> {
  const list = await participants(b);
  await publish(b, { t: "presence", participants: list });
  return list;
}

export async function join(b: BoardRef, connId: string, user: { id: string; name: string; avatarMediaId: string | null }): Promise<void> {
  const k = keys(b);
  await getRedis().multi().hset(k.presence, connId, JSON.stringify({ userId: user.id, name: user.name, avatarMediaId: user.avatarMediaId, at: Date.now() } satisfies PresenceEntry)).expire(k.presence, STATE_TTL_S).exec();
  await publishPresence(b);
}

export async function heartbeat(b: BoardRef, connId: string): Promise<void> {
  const k = keys(b);
  const raw = await getRedis().hget(k.presence, connId);
  if (!raw) return;
  const e = JSON.parse(raw) as PresenceEntry;
  await getRedis().hset(k.presence, connId, JSON.stringify({ ...e, at: Date.now() }));
}

/** Returns how many people are still on the board. */
export async function leave(b: BoardRef, connId: string, userId: string): Promise<number> {
  const k = keys(b);
  await getRedis().hdel(k.presence, connId);
  const list = await participants(b);
  if (!list.some((p) => p.userId === userId)) {
    await releaseLocksOf(b, userId);
    await getRedis().hdel(k.sel, userId);
  }
  await publish(b, { t: "presence", participants: list });
  return list.length;
}

export async function setSelection(b: BoardRef, userId: string, ids: string[]): Promise<void> {
  const k = keys(b);
  await getRedis().multi().hset(k.sel, userId, JSON.stringify(ids)).expire(k.sel, STATE_TTL_S).exec();
  await publish(b, { t: "select", userId, ids });
}

export async function readLocks(b: BoardRef): Promise<Record<string, string>> {
  const raw = await getRedis().hgetall(keys(b).locks);
  const now = Date.now();
  const out: Record<string, string> = {};
  for (const [id, v] of Object.entries(raw)) {
    const [owner, until] = splitLock(v);
    if (until > now) out[id] = owner;
  }
  return out;
}

function splitLock(v: string): [string, number] {
  const i = v.lastIndexOf("|");
  return [v.slice(0, i), Number(v.slice(i + 1))];
}

async function releaseLocksOf(b: BoardRef, userId: string, except?: string): Promise<void> {
  const k = keys(b);
  const raw = await getRedis().hgetall(k.locks);
  const mine = Object.entries(raw)
    .filter(([id, v]) => splitLock(v)[0] === userId && id !== except)
    .map(([id]) => id);
  if (mine.length) {
    await getRedis().hdel(k.locks, ...mine);
    for (const id of mine) await publish(b, { t: "lock", userId, id, on: false });
  }
}

/** Soft lock while typing. Returns false when someone else holds the item. One lock per user. */
export async function setEditing(b: BoardRef, userId: string, itemId: string | null): Promise<boolean> {
  const k = keys(b);
  await releaseLocksOf(b, userId, itemId ?? undefined);
  if (!itemId) return true;
  const now = Date.now();
  const current = await getRedis().hget(k.locks, itemId);
  if (current) {
    const [owner, until] = splitLock(current);
    if (owner !== userId && until > now) return false;
  }
  await getRedis().multi().hset(k.locks, itemId, `${userId}|${now + LOCK_MS}`).expire(k.locks, STATE_TTL_S).exec();
  if (!current || splitLock(current)[0] !== userId) await publish(b, { t: "lock", userId, id: itemId, on: true });
  return true;
}

export async function publishFlushed(b: BoardRef, versionNo: number): Promise<void> {
  await publish(b, { t: "flushed", versionNo });
}

// ---------------------------------------------------------------------------
// Board token: the ops endpoint checks a signature instead of loading session
// and membership for every drag frame. Re-issued by the event stream after a
// fresh membership check, so a lock takes effect within TOKEN_TTL_MS.
// ---------------------------------------------------------------------------

export const TOKEN_TTL_MS = 10 * 60_000;

/** `kind` and `lockColumns` let the ops endpoint check items without loading the entry. */
export type BoardToken = { userId: string; communityId: string; contentId: string; key: string; kind: LiveBoardKind; lockColumns?: boolean; exp: number };

function sign(payload: string): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET).update(`wb:${payload}`).digest("base64url");
}

export function issueToken(t: Omit<BoardToken, "exp">): string {
  const payload = Buffer.from(JSON.stringify({ ...t, exp: Date.now() + TOKEN_TTL_MS })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string, b: BoardRef): BoardToken | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const t = JSON.parse(Buffer.from(payload, "base64url").toString()) as BoardToken;
    if (t.exp < Date.now() || t.contentId !== b.contentId || t.key !== b.key) return null;
    return t;
  } catch {
    return null;
  }
}

/** Per-user request budget on the ops endpoint (drag frames are batched client-side). */
export async function withinRateLimit(userId: string, perSecond = 30): Promise<boolean> {
  const key = `aiup:wb:rl:${userId}:${Math.floor(Date.now() / 1000)}`;
  const n = await getRedis().multi().incr(key).expire(key, 2).exec();
  return Number(n?.[0]?.[1] ?? 0) <= perSecond;
}

/** After a version was written outside the session: hand every live board of it to a running session. */
export async function syncLiveBoards(contentId: string, structure: { definition: StructureDefinition; answers: StructureAnswers }): Promise<void> {
  for (const el of structure.definition.elements) {
    if (!isLiveBoardElement(el)) continue;
    const items = liveItemsOf(el, structure.answers[el.key]);
    try {
      await resetLiveBoard({ contentId, key: el.key }, items, liveHash(el, items));
    } catch (err) {
      logger.warn({ err, contentId, key: el.key }, "live board: reset failed");
    }
  }
}

/** Cheap check for the heartbeat safety net: unsaved changes that have been quiet for a while. */
export async function staleDirty(b: BoardRef, quietMs: number): Promise<boolean> {
  const [dirtySince, lastAt] = await getRedis().hmget(keys(b).meta, "dirtySince", "lastAt");
  return Boolean(dirtySince) && Date.now() - Number(lastAt ?? dirtySince) > quietMs;
}
