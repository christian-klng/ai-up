"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { FlaskConical } from "lucide-react";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { saveEventsAction, testEventsAction, type EventsFormState } from "@/server/actions/admin-integrations";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function EventsForm({ initial, lastTest }: { initial: { enabled: boolean; url: string }; lastTest: string | null }) {
  const t = useTranslations("admin.integrations");
  const tc = useTranslations("common");
  const router = useRouter();
  const [state, action, pending] = useActionState<EventsFormState, FormData>(saveEventsAction, { status: "idle" });
  const [testing, startTest] = useTransition();
  const [testResult, setTestResult] = useState<string | null>(null);
  useActionFeedback(state, (s) => {
    if (s.status === "saved") {
      toast.success(tc("saved"));
      router.refresh();
    } else if (s.status === "error") toast.error(s.code === "unexpected" ? tc("unexpectedError") : t(`events.errors.${s.code}`));
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("events.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {/* keyed by the stored values: React resets the form after the action, the fresh defaults must win */}
        <form key={`${initial.enabled}-${initial.url}`} action={action} className="grid gap-4">
          <p className="text-sm text-muted-foreground">{t("events.intro")}</p>
          <div className="flex items-start gap-3">
            <Switch id="ev-enabled" name="enabled" defaultChecked={initial.enabled} />
            <div className="grid gap-0.5">
              <Label htmlFor="ev-enabled">{t("events.enabled")}</Label>
              <p className="text-xs text-muted-foreground">{t("events.enabledHint")}</p>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ev-url">{t("events.url")}</Label>
            <Input id="ev-url" name="url" defaultValue={initial.url} placeholder="https://events.example.com" className="font-mono text-sm" />
            <p className="text-xs text-muted-foreground">{t("events.urlHint")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pending}>
              {tc("save")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={testing || !initial.url}
              onClick={() =>
                startTest(async () => {
                  setTestResult(null);
                  const res = await testEventsAction();
                  setTestResult(res.ok ? t("events.testOk", { count: res.count, ms: res.ms }) : t("events.testFailed", { error: res.error }));
                  router.refresh();
                })
              }
            >
              <FlaskConical className="size-4" /> {t("events.test")}
            </Button>
            {testResult && <span className="text-sm">{testResult}</span>}
          </div>
          {lastTest && <p className="text-xs text-muted-foreground">{t("events.lastTest", { result: lastTest })}</p>}
        </form>
      </CardContent>
    </Card>
  );
}
