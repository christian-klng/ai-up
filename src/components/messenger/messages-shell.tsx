"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useFormatter, useNow } from "next-intl";
import { MessageSquarePlus } from "lucide-react";
import { useRealtimeEvent } from "@/components/realtime/realtime-provider";
import { openDirectConversationAction } from "@/server/actions/messages";
import { UserAvatar } from "@/components/shell/user-avatar";
import { cn } from "@/lib/utils";

export type ConversationRow = {
  id: string;
  other: { id: string; name: string; avatarMediaId: string | null; isBot?: boolean; online: boolean } | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastMessageSenderId: string | null;
  unreadCount: number;
};

type Props = {
  meId: string;
  conversations: ConversationRow[];
  contacts: { id: string; name: string; avatarMediaId: string | null; online: boolean }[];
  labels: { title: string; empty: string; emptyHint: string; contacts: string; you: string; startChat: string; bot: string };
  children: React.ReactNode;
};

/** Two-pane messenger: conversation list (live) + thread. On small screens only one pane is visible. */
export function MessagesShell({ meId, conversations, contacts, labels, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const [pending, start] = useTransition();
  const activeId = pathname.startsWith("/messages/") ? pathname.split("/")[2] : null;
  const [rows, setRows] = useState(conversations);
  const [prevConversations, setPrevConversations] = useState(conversations);
  if (prevConversations !== conversations) {
    setPrevConversations(conversations);
    setRows(conversations);
  }

  // Live: bump previews/unread counters without a full refetch; other members' reads don't matter here.
  useRealtimeEvent("message.created", ({ message }) => {
    if (!rows.some((r) => r.id === message.conversationId)) {
      // New conversation for this user – fetch the list from the server.
      router.refresh();
      return;
    }
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.id === message.conversationId);
      if (idx === -1) return prev;
      const isActive = activeId === message.conversationId;
      const mine = message.senderId === meId;
      const updated: ConversationRow = {
        ...prev[idx],
        lastMessageAt: message.createdAt,
        lastMessagePreview: message.body || (message.attachments[0] ? `📎 ${message.attachments[0].name}` : ""),
        lastMessageSenderId: message.senderId,
        unreadCount: mine || isActive ? 0 : prev[idx].unreadCount + 1,
      };
      return [updated, ...prev.filter((_, i) => i !== idx)];
    });
  });
  useRealtimeEvent("message.count", () => {
    // Own read state changed – the open conversation is read now.
    if (activeId) setRows((prev) => prev.map((r) => (r.id === activeId ? { ...r, unreadCount: 0 } : r)));
  });

  const sorted = useMemo(() => rows, [rows]);

  const list = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-3 py-3">
        <h1 className="text-lg font-semibold tracking-tight">{labels.title}</h1>
      </div>
      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 && contacts.length === 0 && (
          <div className="px-4 py-6 text-sm text-muted-foreground">
            <p>{labels.empty}</p>
            <p className="mt-1">{labels.emptyHint}</p>
          </div>
        )}
        <ul className="grid gap-0.5 px-2">
          {sorted.map((c) => {
            const active = c.id === activeId;
            const other = c.other;
            return (
              <li key={c.id}>
                <Link
                  href={`/messages/${c.id}`}
                  className={cn("flex items-center gap-3 rounded-md px-2 py-2 transition-colors", active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60")}
                  aria-current={active ? "page" : undefined}
                >
                  <span className="relative shrink-0">
                    {other ? <UserAvatar user={other} size={40} variant="thumb" /> : <span className="block size-10 rounded-full bg-muted" />}
                    {other?.online && !other.isBot && <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-emerald-500 ring-2 ring-background" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={cn("truncate text-sm", c.unreadCount > 0 ? "font-semibold" : "font-medium")}>
                        {other?.name ?? "–"}
                        {other?.isBot && <span className="ml-1.5 rounded bg-primary/10 px-1 text-[10px] font-medium uppercase text-primary">{labels.bot}</span>}
                      </span>
                      {c.lastMessageAt && <span className="shrink-0 text-[11px] text-muted-foreground">{format.relativeTime(new Date(c.lastMessageAt), now)}</span>}
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      <span className={cn("truncate text-xs", c.unreadCount > 0 ? "text-foreground" : "text-muted-foreground")}>
                        {c.lastMessageSenderId === meId && c.lastMessagePreview ? `${labels.you}: ` : ""}
                        {c.lastMessagePreview ?? ""}
                      </span>
                      {c.unreadCount > 0 && <span className="shrink-0 rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-4 text-primary-foreground">{c.unreadCount}</span>}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        {contacts.length > 0 && (
          <div className="mt-4 px-2">
            <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{labels.contacts}</div>
            <ul className="grid gap-0.5">
              {contacts.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const res = await openDirectConversationAction(c.id);
                        if (res.ok) router.push(`/messages/${res.conversationId}`);
                      })
                    }
                    className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent/60"
                  >
                    <UserAvatar user={c} size={32} variant="thumb" />
                    <span className="min-w-0 flex-1 truncate text-sm">{c.name}</span>
                    <MessageSquarePlus className="size-4 text-muted-foreground" aria-label={labels.startChat} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100svh-3.5rem)] sm:-mx-6 lg:-mx-8">
      <aside className={cn("w-full shrink-0 border-r md:block md:w-80", activeId && "hidden")}>{list}</aside>
      <section className={cn("min-w-0 flex-1", !activeId && "hidden md:flex md:items-center md:justify-center")}>{children}</section>
    </div>
  );
}
