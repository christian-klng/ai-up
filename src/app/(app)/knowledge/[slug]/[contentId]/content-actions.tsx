"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Copy, Download, MoreHorizontal, Pin, PinOff, Trash2 } from "lucide-react";
import { deleteContentAction, togglePinAction } from "@/server/actions/content";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function ContentActions({ contentId, areaSlug, pinned, canEdit, isAdmin, markdown, title }: { contentId: string; areaSlug: string; pinned: boolean; canEdit: boolean; isAdmin: boolean; markdown?: string | null; title?: string }) {
  const t = useTranslations("knowledge.view");
  const ts = useTranslations("knowledge.structured");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();
  const hasMarkdown = !!markdown?.trim();
  if (!canEdit && !isAdmin && !hasMarkdown) return null;

  const downloadMarkdown = () => {
    if (!markdown) return;
    const name = `${(title ?? "entry").replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "").toLowerCase() || "entry"}.md`;
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={tc("actions")} disabled={pending}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {hasMarkdown && (
          <>
            <DropdownMenuItem
              onSelect={() =>
                start(async () => {
                  await navigator.clipboard.writeText(markdown!);
                  toast.success(ts("copied"));
                })
              }
            >
              <Copy className="size-4" /> {ts("copyMarkdown")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={downloadMarkdown}>
              <Download className="size-4" /> {ts("downloadMarkdown")}
            </DropdownMenuItem>
          </>
        )}
        {isAdmin && (
          <DropdownMenuItem
            onSelect={() =>
              start(async () => {
                await togglePinAction(contentId, !pinned);
                router.refresh();
              })
            }
          >
            {pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />} {pinned ? t("unpin") : t("pin")}
          </DropdownMenuItem>
        )}
        {canEdit && (
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => {
              if (!confirm(t("confirmDelete"))) return;
              start(async () => {
                const res = await deleteContentAction(contentId);
                if (res.ok) {
                  toast.success(t("deleted"));
                  router.push(`/knowledge/${res.areaSlug ?? areaSlug}`);
                  router.refresh();
                } else toast.error(tc("unexpectedError"));
              });
            }}
          >
            <Trash2 className="size-4" /> {t("delete")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
