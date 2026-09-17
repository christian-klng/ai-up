"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Copy } from "lucide-react";
import { setJoinLinkEnabledAction, type JoinLinkState } from "@/server/actions/admin-settings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * The community's join link: while it is on, anyone holding the URL becomes an active member without
 * approval. Same shape as a meeting's invite link, so admins recognise what they are handing out.
 */
export function JoinLinkCard({ initial }: { initial: JoinLinkState }) {
  const t = useTranslations("admin.members.joinLink");
  const tc = useTranslations("common");
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [pending, start] = useTransition();

  const copy = (url: string) => {
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success(t("copied")))
      .catch(() => toast.error(t("copyFailed")));
  };

  const toggle = (enabled: boolean) =>
    start(async () => {
      const res = await setJoinLinkEnabledAction(enabled);
      if (res.ok) {
        setState(res.state);
        toast.success(res.state.enabled ? t("enabledToast") : t("disabledToast"));
        router.refresh();
      } else toast.error(tc("unexpectedError"));
    });

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("intro")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex items-center justify-between gap-4 rounded-md border p-3">
          <div>
            <Label htmlFor="join-enabled">{t("enabled")}</Label>
            <p className="text-xs text-muted-foreground">{t("uses", { count: state.useCount })}</p>
          </div>
          <Switch id="join-enabled" checked={state.enabled} disabled={pending} onCheckedChange={toggle} />
        </div>
        {state.enabled && state.url ? (
          <div className="flex min-w-0 items-center gap-2 rounded-md border bg-muted/40 p-3">
            <code className="min-w-0 flex-1 truncate text-xs">{state.url}</code>
            <Button variant="outline" size="sm" onClick={() => copy(state.url!)}>
              <Copy className="size-4" /> {t("copy")}
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("disabledHint")}</p>
        )}
      </CardContent>
    </Card>
  );
}
