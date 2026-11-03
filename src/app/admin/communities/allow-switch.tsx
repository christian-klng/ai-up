"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { setAllowPublicCommunitiesAction, setAllowSubcommunitiesAction } from "@/server/actions/communities";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * Operator switches: may ordinary members of the root start their own communities, and may anyone
 * else? Two of them because the second opens the installation to the internet – turning on the first
 * must not do that as a side effect.
 */
export function AllowSubcommunitiesSwitch({ initial, initialPublic }: { initial: boolean; initialPublic: boolean }) {
  const t = useTranslations("admin.communities.allow");
  const tc = useTranslations("common");
  const router = useRouter();
  const [allowed, setAllowed] = useState(initial);
  const [allowedPublic, setAllowedPublic] = useState(initialPublic);
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

  const togglePublic = (next: boolean) =>
    start(async () => {
      const res = await setAllowPublicCommunitiesAction(next);
      if (!res.ok) {
        toast.error(tc("unexpectedError"));
        return;
      }
      setAllowedPublic(next);
      toast.success(next ? t("publicEnabledToast") : t("publicDisabledToast"));
      router.refresh();
    });

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="flex items-center justify-between gap-4 rounded-md border p-3">
          <Label htmlFor="allow-subcommunities">{t("label")}</Label>
          <Switch id="allow-subcommunities" checked={allowed} disabled={pending} onCheckedChange={toggle} />
        </div>
        <div className="flex items-center justify-between gap-4 rounded-md border p-3">
          <div className="grid gap-1">
            <Label htmlFor="allow-public-communities">{t("publicLabel")}</Label>
            <p className="text-xs text-muted-foreground">{t("publicHelp")}</p>
          </div>
          <Switch id="allow-public-communities" checked={allowedPublic} disabled={pending} onCheckedChange={togglePublic} />
        </div>
      </CardContent>
    </Card>
  );
}
