import { randomUUID } from "node:crypto";
import { getCurrentUser } from "@/server/auth/session";
import { getMembership } from "@/server/domain/communities";
import { createSubscriber } from "@/server/redis";
import { logger } from "@/server/logger";
import { boardAccess } from "@/server/whiteboards/access";
import { FLUSH_ON_LEAVE_MS, FLUSH_QUIET_MS } from "@/server/whiteboards/flush";
import { boardChannel, ensureLoaded, heartbeat, issueToken, join, leave, participants, readLocks, readState, staleDirty } from "@/server/whiteboards/state";
import { scheduleWhiteboardFlush } from "@/server/workflows/queue";
import type { WhiteboardEvent } from "@/lib/whiteboard-live";

export const dynamic = "force-dynamic";
export const maxDuration = 0;

const HEARTBEAT_MS = 15_000;
const TOKEN_REFRESH_MS = 5 * 60_000;

/**
 * Event stream of one live whiteboard (docs/whiteboard.md 5.1). First frame is a snapshot with a
 * board token for the ops endpoint; after that every op, presence change, selection and soft lock
 * of the board. Events published while the snapshot is read are buffered and filtered by seq, so
 * nothing is applied twice or lost.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/whiteboards/[contentId]/[key]/events">) {
  const { contentId, key } = await ctx.params;
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return new Response("unauthorized", { status: 401 });
  const access = await boardAccess(user, contentId, key);
  if (!access) return new Response("not found", { status: 404 });

  const b = { contentId, key };
  const communityId = user.communityId;
  await ensureLoaded(b, communityId, access.items);

  const encoder = new TextEncoder();
  const sub = createSubscriber();
  const connId = randomUUID();
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let tokenTimer: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: WhiteboardEvent | string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(typeof event === "string" ? event : `data: ${JSON.stringify(event)}\n\n`));
        } catch {
          void cleanup();
        }
      };
      const cleanup = async () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeatTimer);
        clearInterval(tokenTimer);
        sub.unsubscribe().catch(() => {});
        sub.quit().catch(() => {});
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        try {
          const remaining = await leave(b, connId, user.id);
          // Last one out: save soon (a reload reconnects within the delay).
          if (remaining === 0) await scheduleWhiteboardFlush(contentId, key, FLUSH_ON_LEAVE_MS, { expedite: true });
        } catch (err) {
          logger.warn({ err, contentId, key }, "whiteboard: leave failed");
        }
      };

      let snapshotSeq = -1;
      const buffered: string[] = [];
      const forward = (raw: string) => {
        try {
          const event = JSON.parse(raw) as WhiteboardEvent;
          if ((event.t === "ops" || event.t === "reset") && event.seq <= snapshotSeq) return;
        } catch {
          return;
        }
        send(`data: ${raw}\n\n`);
      };
      sub.on("message", (_channel, raw: string) => {
        if (snapshotSeq < 0) buffered.push(raw);
        else forward(raw);
      });
      sub.on("error", () => void cleanup());

      try {
        await sub.subscribe(boardChannel(b));
        await join(b, connId, { id: user.id, name: user.name, avatarMediaId: user.avatarMediaId });
        let state = await readState(b);
        if (!state) {
          // saved and dropped between our load and now – load again from the (new) version
          const fresh = await boardAccess(user, contentId, key);
          if (!fresh) throw new Error("board gone");
          await ensureLoaded(b, communityId, fresh.items);
          state = await readState(b);
        }
        if (!state) throw new Error("board state unavailable");
        const [locks, people] = await Promise.all([readLocks(b), participants(b)]);
        send(`retry: 3000\n\n`);
        send({ t: "snapshot", seq: state.seq, items: state.items, participants: people, locks, token: issueToken({ userId: user.id, communityId, contentId, key }), me: user.id });
        snapshotSeq = state.seq;
        for (const raw of buffered.splice(0)) forward(raw);
      } catch (err) {
        logger.error({ err, contentId, key }, "whiteboard stream: start failed");
        send({ t: "revoked" });
        await cleanup();
        return;
      }

      heartbeatTimer = setInterval(() => {
        send(`: ping ${Date.now()}\n\n`);
        void heartbeat(b, connId).catch(() => {});
        // Safety net: unsaved changes without a pending save (e.g. an op landed while the last save finished).
        void staleDirty(b, FLUSH_QUIET_MS + 30_000)
          .then((stale) => (stale ? scheduleWhiteboardFlush(contentId, key, 0) : undefined))
          .catch(() => {});
      }, HEARTBEAT_MS);

      // Fresh token only after a fresh check: a member locked meanwhile, or an entry deleted, ends the session.
      tokenTimer = setInterval(() => {
        void (async () => {
          const membership = await getMembership(communityId, user.id);
          const still = membership?.status === "active" ? await boardAccess({ id: user.id, role: membership.role, communityId }, contentId, key) : undefined;
          if (!still) {
            send({ t: "revoked" });
            await cleanup();
            return;
          }
          send({ t: "token", token: issueToken({ userId: user.id, communityId, contentId, key }) });
        })().catch((err) => logger.warn({ err, contentId, key }, "whiteboard: token refresh failed"));
      }, TOKEN_REFRESH_MS);

      req.signal.addEventListener("abort", () => void cleanup());
    },
    cancel() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeatTimer);
      clearInterval(tokenTimer);
      sub.quit().catch(() => {});
      void leave(b, connId, user.id)
        .then((remaining) => (remaining === 0 ? scheduleWhiteboardFlush(contentId, key, FLUSH_ON_LEAVE_MS, { expedite: true }) : undefined))
        .catch(() => {});
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
