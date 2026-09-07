"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { MessageSquarePlus, PanelLeft, Trash2 } from "lucide-react";
import { createThreadAction, deleteThreadAction } from "@/server/actions/agents";
import { UserAvatar } from "@/components/shell/user-avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ThreadRow = { id: string; title: string; lastMessageAt: string | null };

/** Two-pane agent view: thread list + chat. On small screens only one pane is visible. */
export function AgentShell({
  agent,
  slug,
  threads,
  children,
}: {
  agent: { name: string; avatarMediaId: string | null; description: string | null };
  slug: string;
  threads: ThreadRow[];
  children: React.ReactNode;
}) {
  const t = useTranslations("agents");
  const pathname = usePathname();
  const router = useRouter();
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const [pending, start] = useTransition();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  // On phones only one pane fits. The conversation wins by default (that is where the work is);
  // this toggles the list on top of it.
  const [listOpen, setListOpen] = useState(false);
  const activeId = pathname.startsWith(`/agents/${slug}/`) ? pathname.split("/")[3] : null;

  const newThread = () =>
    start(async () => {
      const res = await createThreadAction(slug);
      if (res.ok) {
        setListOpen(false);
        router.push(`/agents/${slug}/${res.threadId}`);
      }
    });

  const remove = (id: string) =>
    start(async () => {
      await deleteThreadAction(id);
      setConfirmId(null);
      if (activeId === id) router.push(`/agents/${slug}`);
      else router.refresh();
    });

  const list = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-3 py-3">
        <UserAvatar user={agent} size={36} variant="thumb" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold tracking-tight">{agent.name}</h1>
          {agent.description && <p className="truncate text-xs text-muted-foreground">{agent.description}</p>}
        </div>
      </div>
      <div className="px-3 pb-2">
        <Button type="button" variant="outline" size="sm" className="w-full" disabled={pending} onClick={newThread}>
          <MessageSquarePlus className="size-4" /> {t("newThread")}
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {threads.length === 0 && <p className="px-2 py-4 text-xs text-muted-foreground">{t("noThreads")}</p>}
        <ul className="grid gap-0.5">
          {threads.map((th) => {
            const active = th.id === activeId;
            return (
              <li key={th.id} className="group relative">
                <Link
                  href={`/agents/${slug}/${th.id}`}
                  onClick={() => setListOpen(false)}
                  className={cn("flex flex-col gap-0.5 rounded-md px-2.5 py-2 pr-9 transition-colors", active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60")}
                  aria-current={active ? "page" : undefined}
                >
                  <span className="truncate text-sm">{th.title || t("untitled")}</span>
                  {th.lastMessageAt && <span className="text-[11px] text-muted-foreground">{format.relativeTime(new Date(th.lastMessageAt), now)}</span>}
                </Link>
                {confirmId === th.id ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => remove(th.id)}
                    className="absolute right-1 top-1.5 rounded px-1.5 py-1 text-[11px] font-medium text-destructive hover:bg-destructive/10"
                  >
                    {t("confirmDelete")}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmId(th.id)}
                    aria-label={t("deleteThread")}
                    className="absolute right-1 top-1.5 rounded p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );

  return (
    <div className="-mx-4 -my-6 flex h-[calc(100svh-3.5rem)] sm:-mx-6 lg:-mx-8">
      <aside className={cn("w-full shrink-0 border-r md:block md:w-72", !listOpen && "hidden")}>{list}</aside>
      <section className={cn("flex min-w-0 flex-1 flex-col", listOpen && "hidden md:flex")}>
        <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1.5 md:hidden">
          <Button type="button" variant="ghost" size="sm" onClick={() => setListOpen(true)}>
            <PanelLeft className="size-4" /> {t("threads")}
          </Button>
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </section>
    </div>
  );
}
