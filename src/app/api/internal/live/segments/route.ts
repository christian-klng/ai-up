import { z } from "zod";
import { recordListenerReport } from "@/server/domain/live-settings";
import { logger } from "@/server/logger";
import { verifyListener } from "../verify";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  meetingId: z.string().uuid(),
  audioSeconds: z.number().min(0).max(24 * 3600),
  segments: z
    .array(
      z.object({
        id: z.string().uuid(),
        session: z.string().min(1).max(100),
        participantIdentity: z.string().min(1).max(200),
        speakerName: z.string().max(500),
        trackSid: z.string().min(1).max(100),
        startedAt: z.string().datetime(),
        endedAt: z.string().datetime(),
        text: z.string().max(20_000),
        language: z.string().max(20).nullable(),
      }),
    )
    .max(500),
});

/** Listener → app: final segments and audio usage, batched every few seconds (docs/live-ki-agenten.md 4.4). */
export async function POST(req: Request) {
  const raw = await req.text();
  const denied = verifyListener(req, raw);
  if (denied) return denied;
  let parsed;
  try {
    parsed = bodySchema.safeParse(JSON.parse(raw));
  } catch {
    return new Response("invalid json", { status: 400 });
  }
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const result = await recordListenerReport(parsed.data);
  if (!result) return new Response("not found", { status: 404 });
  logger.debug({ meetingId: parsed.data.meetingId, stored: result.stored, audioSeconds: parsed.data.audioSeconds }, "live segments stored");
  return Response.json(result);
}
