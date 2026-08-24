import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { getAppSettings } from "@/server/domain/settings";
import { countUsersByStatus } from "@/server/domain/users";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";

export default async function HomePage() {
  const user = await requireUser();
  const [t, settings] = await Promise.all([getTranslations("home"), getAppSettings()]);
  const counts = user.role === "admin" ? await countUsersByStatus() : null;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={t("welcome", { name: user.name })} description={t("intro")} />

      {settings.purpose && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">{settings.name}</CardTitle>
            <CardDescription className="whitespace-pre-line text-foreground/80">{settings.purpose}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {counts && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("pendingMembers", { count: counts.pending })}</CardTitle>
            <CardDescription>{t("adminHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant={counts.pending > 0 ? "default" : "outline"}>
              <Link href={counts.pending > 0 ? "/admin/members?status=pending" : "/admin"}>
                {t("openAdmin")} <ArrowRight className="size-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
