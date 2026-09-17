import { getRedis } from "@/server/redis";
import { logger } from "@/server/logger";
import type { RealtimeEvent, RealtimeEventMap, RealtimeEventType } from "@/lib/realtime-events";

export const CHANNEL_PREFIX = "aiup:rt:";
export const userChannel = (userId: string) => `${CHANNEL_PREFIX}user:${userId}`;
/**
 * Broadcasts are per community: a member of one community must not see the live dots, toasts or
 * questions of another. Each SSE connection subscribes to its own community's channel only.
 */
export const communityChannel = (communityId: string) => `${CHANNEL_PREFIX}c:${communityId}`;

async function publish(channel: string, event: RealtimeEvent): Promise<void> {
  try {
    await getRedis().publish(channel, JSON.stringify(event));
  } catch (err) {
    // Realtime is best-effort: never fail the originating request because Redis hiccuped.
    logger.warn({ err, channel, type: event.type }, "realtime publish failed");
  }
}

export function publishToUser<T extends RealtimeEventType>(userId: string, type: T, payload: RealtimeEventMap[T]): Promise<void> {
  return publish(userChannel(userId), { type, payload, at: new Date().toISOString() });
}

export function publishToUsers<T extends RealtimeEventType>(userIds: string[], type: T, payload: RealtimeEventMap[T]): Promise<void> {
  return Promise.all(userIds.map((id) => publishToUser(id, type, payload))).then(() => undefined);
}

/** Sends to everyone currently connected *within one community*. */
export function publishToCommunity<T extends RealtimeEventType>(communityId: string, type: T, payload: RealtimeEventMap[T]): Promise<void> {
  return publish(communityChannel(communityId), { type, payload, at: new Date().toISOString() });
}
