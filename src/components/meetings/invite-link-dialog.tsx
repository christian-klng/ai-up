"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { setInviteEnabledAction } from "@/server/actions/meetings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/** `url` is null until the link has been switched on for the first time (the row is created then). */
export type InviteLinkState = { url: string | null; enabled: boolean; useCount: number };

/** Admin dialog for a meeting's invite link: switch it on or off and copy the URL. */
export function InviteLinkDialog({ meetingId, invite, open, onOpenChange }: { meetingId: string; invite: InviteLinkState; open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useTranslations("meetings.invite");
  const tc = useTranslations("common");
  const router = useRouter();
  const [state, setState] = useState(invite);
  const [pending, start] = useTransition();

  const copy = (url: string) => {
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success(t("copied")))
      .catch(() => toast.error(t("copyFailed")));
  };

  const toggle = (enabled: boolean) => {
    start(async () => {
      const res = await setInviteEnabledAction({ meetingId, enabled });
      if (res.ok) {
        setState((s) => ({ ...s, url: res.url, enabled: res.enabled }));
        toast.success(res.enabled ? t("enabledToast") : t("disabledToast"));
        router.refresh();
      } else toast.error(tc("unexpectedError"));
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("intro")}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-4 rounded-md border p-3">
          <div>
            <Label htmlFor="invite-enabled">{t("enabled")}</Label>
            <p className="text-xs text-muted-foreground">{t("uses", { count: state.useCount })}</p>
          </div>
          <Switch id="invite-enabled" checked={state.enabled} disabled={pending} onCheckedChange={toggle} />
        </div>

        {state.enabled && state.url && (
          <div className="flex min-w-0 items-center gap-2 rounded-md border bg-muted/40 p-3">
            <code className="min-w-0 flex-1 truncate text-xs">{state.url}</code>
            <Button variant="outline" size="sm" onClick={() => copy(state.url!)}>
              <Copy className="size-4" /> {t("copy")}
            </Button>
          </div>
        )}
        {!state.enabled && <p className="text-sm text-muted-foreground">{t("disabledHint")}</p>}
      </DialogContent>
    </Dialog>
  );
}
