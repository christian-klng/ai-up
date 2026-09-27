import { z } from "zod";
import { logger } from "@/server/logger";
import { FLUSH_QUIET_MS } from "@/server/whiteboards/flush";
import { applyOps, setEditing, setSelection, verifyToken, withinRateLimit, type BoardToken } from "@/server/whiteboards/state";
import { scheduleWhiteboardFlush } from "@/server/workflows/queue";
import { WHITEBOARD_ID_REGEX, whiteboardItemProblem, whiteboardItemSchema } from "@/lib/structures/whiteboard";
import { KANBAN_MAX_LIVE_ITEMS, kanbanLiveItemSchema } from "@/lib/structures/kanban";
import { liveLimits, type LiveItem } from "@/lib/structures/live-boards";
import type { LiveOp } from "@/lib/whiteboard-live";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1024 * 1024;

// Whiteboard and kanban ids share the pattern; one schema serves both.
const itemId = z.string().regex(WHITEBOARD_ID_REGEX);
const deleteOp = z.object({ op: z.literal("delete"), id: itemId });
const whiteboardOp = z.discriminatedUnion("op", [z.object({ op: z.literal("upsert"), item: whiteboardItemSchema }), deleteOp]);
const kanbanOp = z.discriminatedUnion("op", [z.object({ op: z.literal("upsert"), item: kanbanLiveItemSchema }), deleteOp]);
const bodySchema = z.object({
  token: z.string().min(1).max(2000),
  clientId: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  // checked per board kind below – the token says which
  ops: z.array(z.unknown()).max(200).optional(),
  select: z.array(itemId).max(KANBAN_MAX_LIVE_ITEMS).optional(),
  editing: itemId.nullable().optional(),
});

/** Validates a batch for the board kind in the token. Returns null when anything is off. */
function parseOps(token: BoardToken, raw: unknown[]): LiveOp<LiveItem>[] | null {
  const ops: LiveOp<LiveItem>[] = [];
  for (const entry of raw) {
    if (token.kind === "kanban") {
      const op = kanbanOp.safeParse(entry);
      if (!op.success) return null;
      // fixed columns come from the template only (existing ones are locked items, new ones stop here)
      if (op.data.op === "upsert" && op.data.item.kind === "column" && token.lockColumns) return null;
      ops.push(op.data);
      continue;
    }
    const op = whiteboardOp.safeParse(entry);
    if (!op.success) return null;
    if (op.data.op === "delete") {
      ops.push(op.data);
      continue;
    }
    if (whiteboardItemProblem(op.data.item)) return null;
    // Authorship is stamped server-side; locked scaffolding only ever comes from the template.
    ops.push({ op: "upsert", item: { ...op.data.item, createdBy: undefined } });
  }
  return ops;
}

/**
 * Changes to a live board – whiteboard or kanban (docs/whiteboard.md 5.2). Authorised by the board
 * token from the event stream – no session lookup per drag frame. Ops are applied atomically in
 * Redis and come back to every client, the sender included, through the stream.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/whiteboards/[contentId]/[key]/ops">) {
  const { contentId, key } = await ctx.params;
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return Response.json({ error: "too_large" }, { status: 413 });
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "invalid" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return Response.json({ error: "invalid" }, { status: 400 });
  const body = parsed.data;

  const b = { contentId, key };
  const token = verifyToken(body.token, b);
  if (!token) return Response.json({ error: "token" }, { status: 401 });
  if (!(await withinRateLimit(token.userId))) return Response.json({ error: "rate" }, { status: 429 });

  const ops = parseOps(token, body.ops ?? []);
  if (!ops) return Response.json({ error: "invalid" }, { status: 400 });

  try {
    let seq: number | undefined;
    let rejected: string[] = [];
    if (ops.length) {
      const result = await applyOps(b, token.userId, body.clientId, ops, liveLimits(token.kind));
      if (result.missing) return Response.json({ error: "resync" }, { status: 409 });
      seq = result.seq;
      rejected = result.rejected;
      if (result.becameDirty) await scheduleWhiteboardFlush(contentId, key, FLUSH_QUIET_MS);
    }
    let lockDenied = false;
    if (body.editing !== undefined) lockDenied = !(await setEditing(b, token.userId, body.editing));
    if (body.select) await setSelection(b, token.userId, body.select);
    return Response.json({ ok: true, seq, rejected, lockDenied });
  } catch (err) {
    logger.error({ err, contentId, key }, "live board ops failed");
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
