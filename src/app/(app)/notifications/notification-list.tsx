"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Bell, Check, MessageCircle, UserPlus, Workflow, X } from "lucide-react";
import { markNotificationReadAction } from "@/server/actions/notifications";
import { respondContactRequestAction } from "@/server/actions/contacts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  read: boolean;
  timeAgo: string;
  /** set when this is an unanswered contact request */
  pendingRequestId: string | null;
};

function iconFor(type: string) {
  if (type.startsWith("contact.")) return type === "contact.accepted" ? MessageCircle : UserPlus;
  if (type.startsWith("workflow.")) return Workflow;
  return Bell;
}

export function NotificationList({ items }: { items: NotificationItem[] }) {
  const t = useTranslations("contacts");
  const router = useRouter();
  const [pending, start] = useTransition();

  const open = (n: NotificationItem) =>
    start(async () => {
      if (!n.read) await markNotificationReadAction(n.id);
      if (n.href) router.push(n.href);
      else router.refresh();
    });

  return (
    <ul className="divide-y rounded-lg border bg-card">
      {items.map((n) => {
        const Icon = iconFor(n.type);
        return (
          <li key={n.id} className={cn("flex gap-3 px-4 py-3", !n.read && "bg-primary/[0.03]")}>
            <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full", n.read ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary")}>
              <Icon className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <button type="button" onClick={() => open(n)} disabled={pending} className="block w-full text-left">
                <span className={cn("block text-sm", !n.read && "font-medium")}>{n.title}</span>
                {n.body && <span className="block truncate text-sm text-muted-foreground">{n.body}</span>}
                <span className="block text-xs text-muted-foreground">{n.timeAgo}</span>
              </button>
              {n.pendingRequestId && (
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const res = await respondContactRequestAction(n.pendingRequestId!, "accept");
                        if (res.ok) {
                          toast.success(t("accepted"));
                          router.refresh();
                        }
                      })
                    }
                  >
                    <Check className="size-4" /> {t("accept")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        await respondContactRequestAction(n.pendingRequestId!, "decline");
                        toast.success(t("declined"));
                        router.refresh();
                      })
                    }
                  >
                    <X className="size-4" /> {t("decline")}
                  </Button>
                </div>
              )}
            </div>
            {!n.read && <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" aria-hidden />}
          </li>
        );
      })}
    </ul>
  );
}
