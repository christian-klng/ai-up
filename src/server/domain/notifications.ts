import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { notifications, type Notification } from "@/server/db/schema";

export type NotificationInput = {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  data?: Record<string, unknown>;
};

export async function createNotification(input: NotificationInput): Promise<Notification> {
  const [row] = await db
    .insert(notifications)
    .values({ userId: input.userId, type: input.type, title: input.title, body: input.body ?? null, data: input.data ?? {} })
    .returning();
  // Realtime fan-out (SSE) is wired in Phase 3; keep a single choke point here.
  return row;
}

export async function createNotifications(inputs: NotificationInput[]): Promise<void> {
  if (!inputs.length) return;
  await db.insert(notifications).values(inputs.map((i) => ({ ...i, body: i.body ?? null, data: i.data ?? {} })));
}

export async function listNotifications(userId: string, limit = 30): Promise<Notification[]> {
  return db.query.notifications.findMany({
    where: eq(notifications.userId, userId),
    orderBy: desc(notifications.createdAt),
    limit,
  });
}

export async function unreadNotificationCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return row?.count ?? 0;
}

export async function markNotificationRead(userId: string, id: string): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId), isNull(notifications.readAt)));
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}
