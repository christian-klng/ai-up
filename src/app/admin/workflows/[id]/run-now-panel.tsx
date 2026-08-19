"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Zap } from "lucide-react";
import { runWorkflowNowAction, setToastAudienceAction } from "@/server/actions/admin-workflows";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function RunNowPanel({ workflowId, triggerType, samplePayload, toastAudience }: { workflowId: string; triggerType: string; samplePayload: Record<string, unknown>; toastAudience: "all" | "admins" }) {
  const t = useTranslations("admin.workflows");
  const router = useRouter();
  const [payload, setPayload] = useState(JSON.stringify(samplePayload, null, 2));
  const [pending, start] = useTransition();
  return (
    <section className="grid gap-3 rounded-lg border bg-card p-4">
      <h2 className="text-sm font-semibold">{t("runNow")}</h2>
      <p className="text-xs text-muted-foreground">{triggerType === "manual" ? t("runNowManualHint") : t("runNowHint")}</p>
      <div className="grid gap-1.5">
        <Label htmlFor="run-payload">{t("payload")}</Label>
        <Textarea id="run-payload" value={payload} onChange={(e) => setPayload(e.target.value)} rows={8} className="font-mono text-xs" />
      </div>
      <Button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await runWorkflowNowAction(workflowId, payload);
            if (res.ok) {
              toast.success(t("runStarted"));
              router.push(`/admin/workflows/${workflowId}/runs/${res.runId}`);
            } else toast.error(res.error);
          })
        }
      >
        <Zap className="size-4" /> {t("runNow")}
      </Button>
      <div className="mt-2 grid gap-1.5 border-t pt-3">
        <Label>{t("toastAudience")}</Label>
        <Select defaultValue={toastAudience} onValueChange={(v) => start(async () => { await setToastAudienceAction(workflowId, v as "all" | "admins"); router.refresh(); })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("toastAll")}</SelectItem>
            <SelectItem value="admins">{t("toastAdmins")}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t("toastAudienceHint")}</p>
      </div>
    </section>
  );
}
