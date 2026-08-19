"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { MoreHorizontal, Pause, Pencil, Play, Trash2, Zap } from "lucide-react";
import Link from "next/link";
import { deleteWorkflowAction, runWorkflowNowAction, setWorkflowStatusAction } from "@/server/actions/admin-workflows";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function WorkflowRowActions({ id, status, name }: { id: string; status: "draft" | "active" | "paused"; name: string }) {
  const t = useTranslations("admin.workflows");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();
  const setStatus = (s: "active" | "paused") =>
    start(async () => {
      await setWorkflowStatusAction(id, s);
      toast.success(s === "active" ? t("activated") : t("paused"));
      router.refresh();
    });
  return (
    <div className="flex items-center gap-1">
      {status === "active" ? (
        <Button variant="outline" size="sm" disabled={pending} onClick={() => setStatus("paused")}>
          <Pause className="size-4" /> {t("pause")}
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled={pending} onClick={() => setStatus("active")}>
          <Play className="size-4" /> {t("activate")}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={tc("actions")} disabled={pending}>
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/admin/workflows/${id}/edit`}>
              <Pencil className="size-4" /> {tc("edit")}
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              start(async () => {
                const res = await runWorkflowNowAction(id);
                if (res.ok) toast.success(t("runStarted"));
                else toast.error(res.error);
                router.refresh();
              })
            }
          >
            <Zap className="size-4" /> {t("runNow")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => {
              if (!confirm(t("confirmDelete", { name }))) return;
              start(async () => {
                await deleteWorkflowAction(id);
                toast.success(t("deleted"));
                router.refresh();
              });
            }}
          >
            <Trash2 className="size-4" /> {tc("delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
