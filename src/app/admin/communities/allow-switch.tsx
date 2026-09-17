"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { setAllowSubcommunitiesAction } from "@/server/actions/communities";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/** Operator switch: may ordinary members of the root start their own communities? */
export function AllowSubcommunitiesSwitch({ initial }: { initial: boolean }) {
  const t = useTranslations("admin.communities.allow");
  const tc = useTranslations("common");
  const router = useRouter();
  const [allowed, setAllowed] = useState(initial);
  const [pending, start] = useTransition();

  const toggle = (next: boolean) =>
    start(async () => {
      const res = await setAllowSubcommunitiesAction(next);
      if (!res.ok) {
        toast.error(tc("unexpectedError"));
        return;
      }
      setAllowed(next);
      toast.success(next ? t("enabledToast") : t("disabledToast"));
      router.refresh();
    });

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("intro")}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4 rounded-md border p-3">
          <Label htmlFor="allow-subcommunities">{t("label")}</Label>
          <Switch id="allow-subcommunities" checked={allowed} disabled={pending} onCheckedChange={toggle} />
        </div>
      </CardContent>
    </Card>
  );
}
