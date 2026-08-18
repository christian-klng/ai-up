"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useActionFeedback } from "@/hooks/use-action-feedback";
import { savePurposeAction, type AdminFormState } from "@/server/actions/admin-settings";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";

export function PurposeForm({ purpose }: { purpose: string }) {
  const t = useTranslations("admin.purpose");
  const tc = useTranslations("common");
  const router = useRouter();
  const [state, action, pending] = useActionState<AdminFormState, FormData>(savePurposeAction, { status: "idle" });

  useActionFeedback(state, (s) => {
    if (s.status === "saved") {
      toast.success(tc("saved"));
      router.refresh();
    } else if (s.status === "error") toast.error(tc("unexpectedError"));
  });

  return (
    <Card>
      <CardContent className="pt-6">
        <form action={action} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="purpose">{t("label")}</Label>
            <Textarea id="purpose" name="purpose" rows={8} maxLength={4000} defaultValue={purpose} placeholder={t("placeholder")} />
            <p className="text-xs text-muted-foreground">{t("hint")}</p>
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
