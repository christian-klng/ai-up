import { getCurrentUser } from "@/server/auth/session";
import { touchLastSeen } from "@/server/domain/users";
import { createSubscriber } from "@/server/redis";
import { BROADCAST_CHANNEL, userChannel } from "@/server/realtime/publish";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 0;

const HEARTBEAT_MS = 25_000;
const PRESENCE_MS = 60_000;

/**
 * Server-Sent Events stream per signed-in user.
 * Subscribes to the user's Redis channel + broadcast channel and forwards events as `data:` frames.
 * Heartbeats keep proxies (Traefik/Coolify) from closing idle connections; presence is refreshed while connected.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return new Response("unauthorized", { status: 401 });

  const encoder = new TextEncoder();
  const sub = createSubscriber();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let presence: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearInterval(presence);
        sub.unsubscribe().catch(() => {});
        sub.quit().catch(() => {});
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      sub.on("message", (_channel, raw) => send(`data: ${raw}\n\n`));
      sub.on("error", () => cleanup());
      try {
        await sub.subscribe(userChannel(user.id), BROADCAST_CHANNEL);
      } catch (err) {
        logger.error({ err }, "sse: subscribe failed");
        cleanup();
        return;
      }

      // Initial frame: tells the client it is connected (and to resync after a reconnect).
      send(`retry: 3000\ndata: ${JSON.stringify({ type: "sync", payload: {}, at: new Date().toISOString() })}\n\n`);
      heartbeat = setInterval(() => send(`: ping ${Date.now()}\n\n`), HEARTBEAT_MS);
      void touchLastSeen(user.id).catch(() => {});
      presence = setInterval(() => void touchLastSeen(user.id).catch(() => {}), PRESENCE_MS);

      req.signal.addEventListener("abort", cleanup);
    },
    cancel() {
      closed = true;
      clearInterval(heartbeat);
      clearInterval(presence);
      sub.quit().catch(() => {});
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
