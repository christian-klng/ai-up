import type { WebhookEvent } from "livekit-server-sdk";
import type { Meeting } from "@/server/db/schema";
import { logger } from "@/server/logger";

/** Placeholder until phase 4e: logs egress lifecycle events. */
export async function handleEgressEvent(meeting: Meeting, ev: WebhookEvent): Promise<void> {
  logger.info({ meetingId: meeting.id, event: ev.event, egressId: ev.egressInfo?.egressId, status: ev.egressInfo?.status }, "egress event (recording handling follows in 4e)");
}
