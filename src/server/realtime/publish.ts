import { getRedis } from "@/server/redis";
import { logger } from "@/server/logger";
import type { RealtimeEvent, RealtimeEventMap, RealtimeEventType } from "@/lib/realtime-events";

export const CHANNEL_PREFIX = "aiup:rt:";
export const userChannel = (userId: string) => `${CHANNEL_PREFIX}user:${userId}`;
export const BROADCAST_CHANNEL = `${CHANNEL_PREFIX}broadcast`;

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

export function publishBroadcast<T extends RealtimeEventType>(type: T, payload: RealtimeEventMap[T]): Promise<void> {
  return publish(BROADCAST_CHANNEL, { type, payload, at: new Date().toISOString() });
}
