"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { FlaskConical } from "lucide-react";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { saveLiveKitAction, testLiveKitAction, type LiveKitFormState } from "@/server/actions/admin-integrations";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type Initial = { enabled: boolean; url: string; apiKey: string; recordingsPath: string; recordingDefault: boolean; hasSecret: boolean; secretMasked: string | null };

export function LiveKitForm({ initial, lastTest }: { initial: Initial; lastTest: string | null }) {
  const t = useTranslations("admin.integrations");
  const tc = useTranslations("common");
  const router = useRouter();
  const [state, action, pending] = useActionState<LiveKitFormState, FormData>(saveLiveKitAction, { status: "idle" });
  const [testing, startTest] = useTransition();
  const [testResult, setTestResult] = useState<string | null>(null);
  useActionFeedback(state, (s) => {
    if (s.status === "saved") {
      toast.success(tc("saved"));
      router.refresh();
    } else if (s.status === "error") toast.error(s.message);
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("livekit.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4">
          <p className="text-sm text-muted-foreground">{t("livekit.intro")}</p>
          <div className="flex items-start gap-3">
            <Switch id="lk-enabled" name="enabled" defaultChecked={initial.enabled} />
            <div className="grid gap-0.5">
              <Label htmlFor="lk-enabled">{t("livekit.enabled")}</Label>
              <p className="text-xs text-muted-foreground">{t("livekit.enabledHint")}</p>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="lk-url">{t("livekit.url")}</Label>
            <Input id="lk-url" name="url" defaultValue={initial.url} placeholder="wss://meet.example.com" required className="font-mono text-sm" />
            <p className="text-xs text-muted-foreground">{t("livekit.urlHint")}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="lk-key">{t("livekit.apiKey")}</Label>
              <Input id="lk-key" name="apiKey" defaultValue={initial.apiKey} required className="font-mono text-sm" autoComplete="off" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="lk-secret">{t("livekit.apiSecret")}</Label>
              <Input id="lk-secret" name="apiSecret" type="password" defaultValue={initial.hasSecret ? "__keep__" : ""} placeholder={initial.hasSecret ? t("livekit.secretKeep", { masked: initial.secretMasked ?? "" }) : ""} className="font-mono text-sm" autoComplete="off" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="lk-path">{t("livekit.recordingsPath")}</Label>
            <Input id="lk-path" name="recordingsPath" defaultValue={initial.recordingsPath} required className="font-mono text-sm" />
            <p className="text-xs text-muted-foreground">{t("livekit.recordingsPathHint")}</p>
          </div>
          <div className="flex items-start gap-3">
            <Switch id="lk-rec" name="recordingDefault" defaultChecked={initial.recordingDefault} />
            <div className="grid gap-0.5">
              <Label htmlFor="lk-rec">{t("livekit.recordingDefault")}</Label>
              <p className="text-xs text-muted-foreground">{t("livekit.recordingDefaultHint")}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pending}>
              {tc("save")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={testing}
              onClick={() =>
                startTest(async () => {
                  setTestResult(null);
                  const res = await testLiveKitAction();
                  setTestResult(res.ok ? t("livekit.testOk", { rooms: res.rooms, ms: res.ms }) : t("livekit.testFailed", { error: res.error }));
                  router.refresh();
                })
              }
            >
              <FlaskConical className="size-4" /> {t("livekit.test")}
            </Button>
            {testResult && <span className="text-sm">{testResult}</span>}
          </div>
          {lastTest && <p className="text-xs text-muted-foreground">{t("livekit.lastTest", { result: lastTest })}</p>}
        </form>
      </CardContent>
    </Card>
  );
}
