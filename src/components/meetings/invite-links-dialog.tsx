"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Ban, Copy, Link2, Plus } from "lucide-react";
import { createInviteAction, revokeInviteAction } from "@/server/actions/meetings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type InviteLinkItem = { id: string; label: string; url: string; useCount: number; createdAt: string; revokedAt: string | null; creatorName: string | null };

/**
 * Admin dialog listing a meeting's invite links: copy, create with a label, revoke.
 * Revoked links stay listed (greyed) so their statistics remain visible.
 */
export function InviteLinksDialog({ meetingId, invites, open, onOpenChange }: { meetingId: string; invites: InviteLinkItem[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("meetings.invites");
  const tc = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [pending, start] = useTransition();

  const copy = (url: string) => {
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success(t("copied")))
      .catch(() => toast.error(t("copyFailed")));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("intro")}</DialogDescription>
        </DialogHeader>

        <form
          className="flex min-w-0 items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await createInviteAction({ meetingId, label });
              if (res.ok) {
                setLabel("");
                copy(res.url);
                router.refresh();
              } else toast.error(tc("unexpectedError"));
            });
          }}
        >
          <div className="grid flex-1 gap-1.5">
            <Label htmlFor="invite-label">{t("label")}</Label>
            <Input id="invite-label" value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={80} placeholder={t("labelPlaceholder")} />
          </div>
          <Button type="submit" disabled={pending || !label.trim()}>
            <Plus className="size-4" /> {t("create")}
          </Button>
        </form>

        {invites.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="min-w-0 divide-y rounded-md border">
            {invites.map((i) => {
              const revoked = !!i.revokedAt;
              return (
                <li key={i.id} className={cn("flex min-w-0 items-center gap-3 px-3 py-2", revoked && "opacity-60")}>
                  <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{i.label}</span>
                      {revoked && <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{t("revoked")}</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t("uses", { count: i.useCount })} · {format.dateTime(new Date(i.createdAt), { dateStyle: "medium" })}
                      {i.creatorName ? ` · ${i.creatorName}` : ""}
                    </div>
                    {!revoked && <code className="block truncate text-xs text-muted-foreground">{i.url}</code>}
                  </div>
                  {!revoked && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => copy(i.url)} aria-label={t("copy")}>
                        <Copy className="size-4" /> {t("copy")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("revoke")}
                        title={t("revoke")}
                        disabled={pending}
                        onClick={() => {
                          if (!confirm(t("confirmRevoke"))) return;
                          start(async () => {
                            const res = await revokeInviteAction(i.id);
                            if (res.ok) {
                              toast.success(t("revokedToast"));
                              router.refresh();
                            } else toast.error(tc("unexpectedError"));
                          });
                        }}
                      >
                        <Ban className="size-4" />
                      </Button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
