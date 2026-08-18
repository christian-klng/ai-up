import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireUser } from "@/server/auth/session";
import { listNotifications } from "@/server/domain/notifications";
import { markAllNotificationsReadAction } from "@/server/actions/notifications";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default async function NotificationsPage() {
  const user = await requireUser();
  const [t, format, items] = await Promise.all([getTranslations("notifications"), getFormatter(), listNotifications(user.id)]);
  const hasUnread = items.some((n) => !n.readAt);

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
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {items.map((n) => {
            const href = typeof n.data.href === "string" ? n.data.href : undefined;
            const inner = (
              <>
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-primary")} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{n.title}</span>
                  {n.body && <span className="block truncate text-sm text-muted-foreground">{n.body}</span>}
                  <span className="block text-xs text-muted-foreground">{format.relativeTime(n.createdAt)}</span>
                </span>
              </>
            );
            return (
              <li key={n.id}>
                {href ? (
                  <Link href={href} className="flex gap-3 px-4 py-3 hover:bg-accent/60">
                    {inner}
                  </Link>
                ) : (
                  <div className="flex gap-3 px-4 py-3">{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
