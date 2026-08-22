import { handleWebhookEvent, verifyWebhook } from "@/server/meetings/livekit";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

/** LiveKit webhook receiver (signed with the API key/secret; see livekit.yaml `webhook`). */
export async function POST(req: Request) {
  const body = await req.text();
  let event;
  try {
    event = await verifyWebhook(body, req.headers.get("authorization"));
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "livekit webhook rejected");
    return new Response("unauthorized", { status: 401 });
  }
  try {
    await handleWebhookEvent(event);
  } catch (err) {
    logger.error({ err, event: event.event }, "livekit webhook handling failed");
    return new Response("error", { status: 500 });
  }
  return new Response("ok");
}
