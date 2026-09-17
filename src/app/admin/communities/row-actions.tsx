"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { RotateCcw, Trash2 } from "lucide-react";
import { adminDeleteCommunityAction, adminRestoreCommunityAction } from "@/server/actions/communities";
import { Button } from "@/components/ui/button";

/** Delete or bring back one sub-community. Deleting is reversible until the purge sweep runs. */
export function CommunityRowActions({ id, name, deleted }: { id: string; name: string; deleted: boolean }) {
  const t = useTranslations("admin.communities");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean }>, successKey: "deletedToast" | "restoredToast") =>
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(tc("unexpectedError"));
        return;
      }
      toast.success(t(successKey, { name }));
      router.refresh();
    });

  if (deleted) {
    return (
      <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => adminRestoreCommunityAction(id), "restoredToast")}>
        <RotateCcw className="size-4" /> {t("restore")}
      </Button>
    );
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-destructive hover:text-destructive"
      disabled={pending}
      onClick={() => {
        if (confirm(t("deleteConfirm", { name }))) run(() => adminDeleteCommunityAction(id), "deletedToast");
      }}
    >
      <Trash2 className="size-4" /> {t("delete")}
    </Button>
  );
}
