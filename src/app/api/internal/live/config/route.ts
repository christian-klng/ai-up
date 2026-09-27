import { listenerConfig } from "@/server/domain/live-settings";
import { verifyListener } from "../verify";

export const dynamic = "force-dynamic";

/** Listener → app at job start: recogniser credentials of the meeting's community (docs/live-ki-agenten.md 4.4). */
export async function GET(req: Request) {
  const denied = verifyListener(req, "");
  if (denied) return denied;
  const meetingId = new URL(req.url).searchParams.get("meetingId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(meetingId)) return new Response("not found", { status: 404 });
  const config = await listenerConfig(meetingId);
  if (!config) return new Response("not found", { status: 404 });
  return Response.json(config, { headers: { "cache-control": "no-store" } });
}
