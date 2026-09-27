import { AgentDispatchClient } from "livekit-server-sdk";
import type { Meeting } from "@/server/db/schema";
import { getLiveKitConfig, livekitHttpUrl } from "@/server/domain/integrations";
import { sttCredentials } from "@/server/domain/live-settings";
import { communityOfMeeting } from "@/server/domain/meetings";
import { env } from "@/server/env";
import { logger } from "@/server/logger";
import { LISTENER_AGENT_NAME, type ListenerDispatchMetadata } from "@/lib/live-listener";

/**
 * Sends the live listener (listener/, docs/live-ki-agenten.md) into a meeting room.
 *
 * Preconditions: the operator runs a listener (LISTENER_SHARED_SECRET is set – without it the internal
 * API is closed anyway), and the meeting's community has live transcription switched on with a key.
 * Called on every participant join; an existing dispatch for the room makes it a no-op.
 */
export async function isLiveTranscriptionAvailable(communityId: string): Promise<boolean> {
  if (!env.LISTENER_SHARED_SECRET) return false;
  return (await sttCredentials(communityId)) !== null;
}

export async function ensureListener(meeting: Meeting): Promise<void> {
  if (meeting.kind === "protocol" || !meeting.roomName || !env.LISTENER_SHARED_SECRET) return;
  const communityId = await communityOfMeeting(meeting.id);
  if (!communityId || !(await isLiveTranscriptionAvailable(communityId))) return;
  const cfg = await getLiveKitConfig();
  if (!cfg?.enabled) return;
  try {
    const client = new AgentDispatchClient(livekitHttpUrl(cfg.url), cfg.apiKey, cfg.apiSecret);
    const existing = await client.listDispatch(meeting.roomName);
    if (existing.some((d) => d.agentName === LISTENER_AGENT_NAME)) return;
    const metadata: ListenerDispatchMetadata = { meetingId: meeting.id };
    await client.createDispatch(meeting.roomName, LISTENER_AGENT_NAME, { metadata: JSON.stringify(metadata) });
    logger.info({ meetingId: meeting.id, room: meeting.roomName }, "live listener dispatched");
  } catch (err) {
    // never block the join: without the listener the call simply runs untranscribed
    logger.warn({ meetingId: meeting.id, err: (err as Error).message }, "live listener dispatch failed");
  }
}
