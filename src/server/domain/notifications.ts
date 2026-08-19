import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { notifications, type Notification } from "@/server/db/schema";
import { publishToUser } from "@/server/realtime/publish";

export type NotificationInput = {
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  data?: Record<string, unknown>;
};

/** Localized copy helper for notifications (stored in the recipient's language). */
export function localized(locale: string, text: { de: string; en: string }): string {
  return locale === "en" ? text.en : text.de;
}

async function fanOut(rows: Notification[]): Promise<void> {
  await Promise.all(
    rows.map(async (n) => {
      const unreadCount = await unreadNotificationCount(n.userId);
      await publishToUser(n.userId, "notification.created", {
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        href: typeof n.data.href === "string" ? n.data.href : null,
        unreadCount,
      });
    }),
  );
}

export async function createNotification(input: NotificationInput): Promise<Notification> {
  const [row] = await db
    .insert(notifications)
    .values({ userId: input.userId, type: input.type, title: input.title, body: input.body ?? null, data: input.data ?? {} })
    .returning();
  void fanOut([row]);
  return row;
}

export async function createNotifications(inputs: NotificationInput[]): Promise<void> {
  if (!inputs.length) return;
  const rows = await db
    .insert(notifications)
    .values(inputs.map((i) => ({ ...i, body: i.body ?? null, data: i.data ?? {} })))
    .returning();
  void fanOut(rows);
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

async function publishCount(userId: string): Promise<void> {
  await publishToUser(userId, "notification.count", { unreadCount: await unreadNotificationCount(userId) });
}

export async function markNotificationRead(userId: string, id: string): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId), isNull(notifications.readAt)));
  void publishCount(userId);
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  void publishCount(userId);
}

/** Marks notifications that reference a resolved item (e.g. an answered contact request) as read. */
export async function resolveNotifications(userId: string, type: string, dataKey: string, value: string): Promise<void> {
  const rows = await db.query.notifications.findMany({ where: and(eq(notifications.userId, userId), eq(notifications.type, type), isNull(notifications.readAt)) });
  const ids = rows.filter((n) => n.data[dataKey] === value).map((n) => n.id);
  if (!ids.length) return;
  await db.update(notifications).set({ readAt: new Date(), data: sql`${notifications.data} || '{"resolved": true}'::jsonb` }).where(inArray(notifications.id, ids));
  void publishCount(userId);
}
