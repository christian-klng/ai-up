import { getFormatter, getTranslations } from "next-intl/server";
import { requireUser } from "@/server/auth/session";
import { listNotifications } from "@/server/domain/notifications";
import { listIncomingRequests } from "@/server/domain/messenger";
import { markAllNotificationsReadAction } from "@/server/actions/notifications";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { NotificationList, type NotificationItem } from "./notification-list";

export default async function NotificationsPage() {
  const user = await requireUser();
  const [t, format, items, incoming] = await Promise.all([getTranslations("notifications"), getFormatter(), listNotifications(user.id), listIncomingRequests(user.id)]);
  const hasUnread = items.some((n) => !n.readAt);
  const pendingByRequester = new Map(incoming.map((r) => [r.requesterId, r.id]));

  const list: NotificationItem[] = items.map((n) => {
    const fromUserId = typeof n.data.fromUserId === "string" ? n.data.fromUserId : undefined;
    const requestId = n.type === "contact.request" && fromUserId && !n.data.resolved ? pendingByRequester.get(fromUserId) : undefined;
    return {
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      href: typeof n.data.href === "string" ? n.data.href : null,
      read: !!n.readAt,
      timeAgo: format.relativeTime(n.createdAt),
      pendingRequestId: requestId ?? null,
    };
  });

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={t("title")}
        actions={
          hasUnread && (
            <form action={markAllNotificationsReadAction}>
              <Button variant="outline" size="sm" type="submit">
                {t("markAllRead")}
              </Button>
            </form>
          )
        }
      />
      {list.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : <NotificationList items={list} />}
    </div>
  );
}
