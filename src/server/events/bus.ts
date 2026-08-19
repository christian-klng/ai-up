import { logger } from "@/server/logger";

/**
 * Domain event bus. Phase 2: in-process handlers + structured log.
 * Phase 3 adds Redis fan-out for realtime (SSE), Phase 5 subscribes the workflow engine (triggers).
 * Keep every domain event flowing through `emitDomainEvent` so later phases only add handlers.
 */
export type DomainEventMap = {
  "content.created": { contentId: string; areaId: string; type: string; title: string; authorId: string | null; versionNo: number; url?: string | null };
  "content.updated": { contentId: string; areaId: string; type: string; title: string; editorId: string | null; versionNo: number; url?: string | null };
  "content.deleted": { contentId: string; areaId: string; actorId: string };
  "member.registered": { userId: string };
  "member.approved": { userId: string; actorId: string };
  "notification.created": { userId: string; notificationId: string };
};

export type DomainEventType = keyof DomainEventMap;
export type DomainEvent<T extends DomainEventType = DomainEventType> = {
  type: T;
  payload: DomainEventMap[T];
  at: string;
};

type Handler<T extends DomainEventType> = (event: DomainEvent<T>) => void | Promise<void>;

const handlers = new Map<DomainEventType, Set<Handler<DomainEventType>>>();

export function onDomainEvent<T extends DomainEventType>(type: T, handler: Handler<T>): () => void {
  const set = handlers.get(type) ?? new Set();
  set.add(handler as Handler<DomainEventType>);
  handlers.set(type, set);
  return () => set.delete(handler as Handler<DomainEventType>);
}

/** Emits an event; handlers run asynchronously and never block or fail the caller. */
export function emitDomainEvent<T extends DomainEventType>(type: T, payload: DomainEventMap[T]): void {
  const event: DomainEvent<T> = { type, payload, at: new Date().toISOString() };
  logger.debug({ event: type, payload }, "domain event");
  const set = handlers.get(type);
  if (!set) return;
  for (const h of set) {
    Promise.resolve()
      .then(() => h(event as DomainEvent<DomainEventType>))
      .catch((err) => logger.error({ err, event: type }, "domain event handler failed"));
  }
}
