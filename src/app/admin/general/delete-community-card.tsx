"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { deleteOwnCommunityAction } from "@/server/actions/communities";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Deleting the community one administers. Typing the name is the confirmation, because this takes
 * collections, meetings, workflows and uploads with it. It stays recoverable by the operator until
 * the grace period runs out.
 */
export function DeleteCommunityCard({ name, graceDays }: { name: string; graceDays: number }) {
  const t = useTranslations("admin.general.deleteCommunity");
  const tc = useTranslations("common");
  const router = useRouter();
  const [confirm, setConfirm] = useState("");
  const [pending, start] = useTransition();

  const remove = () =>
    start(async () => {
      const res = await deleteOwnCommunityAction(confirm);
      if (res.ok) {
        toast.success(t("doneToast", { name }));
        router.push("/home");
        return;
      }
      toast.error(res.reason === "mismatch" ? t("mismatch") : res.reason === "root" ? t("notRoot") : tc("unexpectedError"));
    });

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">{t("title")}</CardTitle>
        <CardDescription>{t("intro", { days: graceDays })}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-2">
          <Label htmlFor="confirm-name">{t("confirmLabel", { name })}</Label>
          <Input id="confirm-name" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={name} autoComplete="off" />
        </div>
        <div>
          <Button variant="destructive" disabled={pending || confirm.trim() !== name.trim()} onClick={remove}>
            {t("submit")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
