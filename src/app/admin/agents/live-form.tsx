"use client";

import { useActionState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CircleAlert, CircleCheck, FlaskConical } from "lucide-react";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { checkLiveKeyAction, saveLiveSettingsAction } from "@/server/actions/admin-live";
import type { AdminFormState } from "@/server/actions/admin-settings";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type Initial = { enabled: boolean; sttModel: string; hasKey: boolean; keyMasked: string | null; checkedAt: Date | null; lastError: string | null };

export function LiveForm({ initial }: { initial: Initial }) {
  const t = useTranslations("admin.agents.live");
  const tc = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const [state, action, pending] = useActionState<AdminFormState, FormData>(saveLiveSettingsAction, { status: "idle" });
  const [checking, startCheck] = useTransition();

  useActionFeedback(state, (s) => {
    if (s.status === "saved") {
      toast.success(tc("saved"));
      router.refresh();
    } else if (s.status === "error") toast.error(s.message ?? tc("unexpectedError"));
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {/* keyed by the stored values: React resets the form after the action, the fresh defaults must win */}
        <form key={`${initial.enabled}-${initial.sttModel}-${initial.keyMasked}`} action={action} className="grid gap-5">
          <div className="flex items-center gap-3">
            <Switch id="live-enabled" name="enabled" defaultChecked={initial.enabled} />
            <Label htmlFor="live-enabled">{t("enabled")}</Label>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>{t("provider")}</Label>
              <Input value="Mistral (Voxtral Realtime)" readOnly disabled />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="live-model">{t("model")}</Label>
              <Input id="live-model" name="sttModel" defaultValue={initial.sttModel} className="font-mono text-sm" autoComplete="off" />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="live-key">{t("apiKey")}</Label>
            <Input
              id="live-key"
              name="apiKey"
              type="password"
              defaultValue={initial.hasKey ? "__keep__" : ""}
              placeholder={initial.hasKey ? t("keyKeep", { masked: initial.keyMasked ?? "" }) : ""}
              className="font-mono text-sm"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">{t("apiKeyHint")}</p>
          </div>
          {initial.checkedAt && (
            <p className={initial.lastError ? "flex items-center gap-1.5 text-sm text-destructive" : "flex items-center gap-1.5 text-sm text-muted-foreground"}>
              {initial.lastError ? <CircleAlert className="size-4" /> : <CircleCheck className="size-4" />}
              {initial.lastError
                ? t("checkFailed", { error: initial.lastError, date: format.dateTime(initial.checkedAt, { dateStyle: "short", timeStyle: "short" }) })
                : t("checkOk", { date: format.dateTime(initial.checkedAt, { dateStyle: "short", timeStyle: "short" }) })}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pending}>
              {tc("save")}
            </Button>
            {initial.hasKey && (
              <Button
                type="button"
                variant="outline"
                disabled={checking}
                onClick={() =>
                  startCheck(async () => {
                    const res = await checkLiveKeyAction();
                    if (res.ok) toast.success(t("checkOkToast"));
                    else toast.error(t("checkFailedToast", { error: res.error }));
                    router.refresh();
                  })
                }
              >
                <FlaskConical className="size-4" /> {t("check")}
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
