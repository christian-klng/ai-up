"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react";
import { deleteSpaceAction, moveSpaceAction } from "@/server/actions/admin-meetings";
import { AreaIcon } from "@/components/knowledge/area-icon";
import { Button } from "@/components/ui/button";
import { SpaceDialog, type SpaceFormValues } from "./space-dialog";

type Space = SpaceFormValues & { slug: string; meetingCount: number; liveCount: number };

export function SpaceList({ spaces }: { spaces: Space[] }) {
  const t = useTranslations("admin.meetings");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();

  if (spaces.length === 0) return <p className="text-sm text-muted-foreground">{t("empty")}</p>;

  return (
    <ul className="divide-y rounded-lg border bg-card">
      {spaces.map((a, i) => (
        <li key={a.id} className="flex flex-wrap items-start gap-4 px-4 py-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
            <AreaIcon icon={a.icon} className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/meetings/${a.slug}`} className="font-medium hover:underline">
                {a.name}
              </Link>
              <span className="text-xs text-muted-foreground">/{a.slug}</span>
              <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{t("meetingCount", { count: a.meetingCount })}</span>
              {a.liveCount > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 text-xs text-emerald-700 dark:text-emerald-300"><span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />{t("liveCount", { count: a.liveCount })}</span>}
            </div>
            <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{a.purpose}</p>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" aria-label="up" disabled={pending || i === 0} onClick={() => start(async () => { await moveSpaceAction(a.id, "up"); router.refresh(); })}>
              <ArrowUp className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="down" disabled={pending || i === spaces.length - 1} onClick={() => start(async () => { await moveSpaceAction(a.id, "down"); router.refresh(); })}>
              <ArrowDown className="size-4" />
            </Button>
            <SpaceDialog
              mode="edit"
              space={a}
              trigger={
                <Button variant="ghost" size="icon" aria-label={tc("edit")}>
                  <Pencil className="size-4" />
                </Button>
              }
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label={tc("delete")}
              disabled={pending}
              onClick={() => {
                if (!confirm(t("confirmDelete", { name: a.name }))) return;
                start(async () => {
                  const res = await deleteSpaceAction(a.id);
                  if (res.ok) {
                    toast.success(t("deleted"));
                    router.refresh();
                  } else toast.error(t("notEmpty"));
                });
              }}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
