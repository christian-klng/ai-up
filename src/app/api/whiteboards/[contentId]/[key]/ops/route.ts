import { z } from "zod";
import { logger } from "@/server/logger";
import { FLUSH_QUIET_MS } from "@/server/whiteboards/flush";
import { applyOps, setEditing, setSelection, verifyToken, withinRateLimit } from "@/server/whiteboards/state";
import { scheduleWhiteboardFlush } from "@/server/workflows/queue";
import { WHITEBOARD_ID_REGEX, WHITEBOARD_MAX_ITEMS, whiteboardItemProblem, whiteboardItemSchema, type WhiteboardOp } from "@/lib/structures/whiteboard";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1024 * 1024;

const itemId = z.string().regex(WHITEBOARD_ID_REGEX);
const opSchema = z.discriminatedUnion("op", [z.object({ op: z.literal("upsert"), item: whiteboardItemSchema }), z.object({ op: z.literal("delete"), id: itemId })]);
const bodySchema = z.object({
  token: z.string().min(1).max(2000),
  clientId: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  ops: z.array(opSchema).max(200).optional(),
  select: z.array(itemId).max(WHITEBOARD_MAX_ITEMS).optional(),
  editing: itemId.nullable().optional(),
});

/**
 * Changes to a live whiteboard (docs/whiteboard.md 5.2). Authorised by the board token from the
 * event stream – no session lookup per drag frame. Ops are applied atomically in Redis and come
 * back to every client, the sender included, through the stream.
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

  const ops: WhiteboardOp[] = [];
  for (const op of body.ops ?? []) {
    if (op.op === "delete") {
      ops.push(op);
      continue;
    }
    if (whiteboardItemProblem(op.item)) return Response.json({ error: "invalid", id: op.item.id }, { status: 400 });
    // Authorship is stamped server-side; locked scaffolding only ever comes from the template.
    ops.push({ op: "upsert", item: { ...op.item, createdBy: undefined } });
  }

  try {
    let seq: number | undefined;
    let rejected: string[] = [];
    if (ops.length) {
      const result = await applyOps(b, token.userId, body.clientId, ops);
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
    logger.error({ err, contentId, key }, "whiteboard ops failed");
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
