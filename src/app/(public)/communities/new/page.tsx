import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { isLocale } from "@/i18n/config";
import { MAX_FOUNDED_COMMUNITIES } from "@/lib/community-creation";
import { getAccount } from "@/server/auth/session";
import { getHostCommunity } from "@/server/community-context";
import { DEFAULT_THEME, communityCreationDecision, loadRootCommunity } from "@/server/domain/communities";
import { env } from "@/server/env";
import { PageHeader } from "@/components/common/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateCommunityForm } from "./create-form";

/**
 * Starting a community. Public while the operator's public switch is on: a visitor confirms by mail,
 * someone signed in gets the community straight away. With the switch off, a visitor finds nothing
 * here at all and the page only serves those the member switch lets in.
 *
 * Main host only, because this is where the cookie selecting the new community counts. On any other
 * host it would be overruled, and the founder would land in the wrong administration.
 */
export default async function NewCommunityPage() {
  if (await getHostCommunity()) redirect(`${env.APP_URL.replace(/\/$/, "")}/communities/new`);
  const [account, root, t, rawLocale] = await Promise.all([getAccount(), loadRootCommunity(), getTranslations("communities.create"), getLocale()]);

  if (account) {
    const decision = await communityCreationDecision(account);
    if (!decision.allowed && decision.reason !== "limit") redirect("/home");
    if (!decision.allowed) {
      return (
        <Card className="mx-auto max-w-md">
          <CardHeader>
            <CardTitle>{t("limitTitle")}</CardTitle>
            <CardDescription>{t("limitBody", { max: MAX_FOUNDED_COMMUNITIES })}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/home" className="text-sm font-medium underline-offset-4 hover:underline">
              {t("backHome")}
            </Link>
          </CardContent>
        </Card>
      );
    }
  } else if (!root.allowPublicCommunities) {
    notFound();
  }

  return (
    <div className="mx-auto max-w-xl">
      <PageHeader title={t("title")} description={t("intro")} />
      <CreateCommunityForm visitor={!account} defaultLocale={account?.locale ?? (isLocale(rawLocale) ? rawLocale : "de")} defaultColor={DEFAULT_THEME.primaryColor} />
    </div>
  );
}
