import { logger } from "@/server/logger";

/**
 * Domain event bus. Phase 2: in-process handlers + structured log.
 * Phase 3 adds Redis fan-out for realtime (SSE), Phase 5 subscribes the workflow engine (triggers).
 * Keep every domain event flowing through `emitDomainEvent` so later phases only add handlers.
 */
/** Where an event came from – workflows tag their own side effects so triggers can avoid loops. */
export type EventOrigin = { kind: "user" } | { kind: "workflow"; runId: string; workflowId: string; depth: number } | { kind: "system" };

export type ContentEventPayload = {
  content: {
    id: string;
    type: string;
    title: string;
    url: string | null;
    body: string | null;
    areaId: string;
    areaSlug: string;
    areaName: string;
    areaPurpose: string;
    authorId: string | null;
    authorName: string | null;
    versionNo: number;
    href: string;
  };
  /** user id who caused the event (author/editor) */
  actorId: string | null;
  origin: EventOrigin;
};

export type DomainEventMap = {
  "content.created": ContentEventPayload;
  "content.updated": ContentEventPayload;
  "content.deleted": { contentId: string; areaId: string; actorId: string };
  "member.registered": { userId: string };
  "member.approved": { userId: string; actorId: string };
  "notification.created": { userId: string; notificationId: string };
  "question.answered": QuestionAnsweredPayload;
  "meeting.created": { meeting: MeetingEventMeeting; actorId: string | null; origin: EventOrigin };
  "meeting.started": { meeting: MeetingEventMeeting; actorId: string | null; origin: EventOrigin };
  "meeting.ended": { meeting: MeetingEventMeeting; actorId: string | null; origin: EventOrigin };
  "meeting.recording.available": { meeting: MeetingEventMeeting; mediaId: string; durationSeconds: number | null; actorId: string | null; origin: EventOrigin };
  /** A member wrote to the system bot in the messenger */
  "bot.message.received": { conversationId: string; messageId: string; text: string; attachments: unknown[]; user: { id: string; name: string }; actorId: string; origin: EventOrigin };
};

export type MeetingEventMeeting = { id: string; title: string; kind: string; status: string; spaceId: string; spaceSlug: string; spaceName: string; hostId: string | null; href: string };

export type QuestionAnsweredPayload = {
  question: { id: string; key: string; title: string; workflowId: string | null; fields: unknown[] };
  response: { answers: Record<string, unknown>; answeredAt: string };
  user: { id: string; name: string };
  stats: { responses: number; distribution: Record<string, Record<string, number>> };
  actorId: string;
  origin: EventOrigin;
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
  if (set) {
    for (const h of set) {
      Promise.resolve()
        .then(() => h(event as DomainEvent<DomainEventType>))
        .catch((err) => logger.error({ err, event: type }, "domain event handler failed"));
    }
  }
  // Workflow triggers: dispatched through a dynamic import (avoids the import cycle dispatch → domain → bus
  // and does not depend on process-level listener registration, which is fragile across bundles).
  void import("@/server/workflows/dispatch")
    .then((m) => m.dispatchEvent(event as DomainEvent<DomainEventType>))
    .catch((err) => logger.error({ err, event: type }, "workflow dispatch failed"));
}
