"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { saveAgentQuotaAction, type AdminFormState } from "@/server/actions/admin-agents";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function QuotaForm({ budget, outputWeight }: { budget: number; outputWeight: number }) {
  const t = useTranslations("admin.agents");
  const tc = useTranslations("common");
  const router = useRouter();
  const [state, action, pending] = useActionState<AdminFormState, FormData>(saveAgentQuotaAction, { status: "idle" });

  useActionFeedback(state, (s) => {
    if (s.status === "saved") {
      toast.success(tc("saved"));
      router.refresh();
    } else if (s.status === "error") toast.error(s.message ?? tc("unexpectedError"));
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("quotaTitle")}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="agentWeeklyTokenBudget">{t("weeklyBudget")}</Label>
              <Input id="agentWeeklyTokenBudget" name="agentWeeklyTokenBudget" type="number" min={0} step={1000} defaultValue={budget} required />
              <p className="text-xs text-muted-foreground">{t("weeklyBudgetHint")}</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="agentOutputTokenWeight">{t("outputWeight")}</Label>
              <Input id="agentOutputTokenWeight" name="agentOutputTokenWeight" type="number" min={1} max={20} defaultValue={outputWeight} required />
              <p className="text-xs text-muted-foreground">{t("outputWeightHint")}</p>
            </div>
          </div>
          <div>
            <Button type="submit" disabled={pending}>
              {tc("save")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
