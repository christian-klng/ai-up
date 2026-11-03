import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getHostCommunity } from "@/server/community-context";
import { isCommunitySlugTaken, loadRootCommunity } from "@/server/domain/communities";
import { peekCommunityRequest } from "@/server/domain/community-requests";
import { env } from "@/server/env";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmCommunityForm } from "./confirm-form";

/** The address carries a secret: keep it out of search engines and away from outgoing links. */
export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * Where the confirmation mail leads. Only looks: the request is used up by the button in the form,
 * because mail scanners open every link and would otherwise create the community on their own.
 */
export default async function ConfirmCommunityPage({ params }: PageProps<"/communities/confirm/[token]">) {
  const { token } = await params;
  if (await getHostCommunity()) redirect(`${env.APP_URL.replace(/\/$/, "")}/communities/confirm/${encodeURIComponent(token)}`);
  const [t, request, root] = await Promise.all([getTranslations("communities.confirm"), peekCommunityRequest(token), loadRootCommunity()]);

  if (!request || !root.allowPublicCommunities) {
    return (
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <CardTitle>{t("invalidTitle")}</CardTitle>
          <CardDescription>{t("invalidBody")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/login" className="text-sm font-medium underline-offset-4 hover:underline">
            {t("toLogin")}
          </Link>
        </CardContent>
      </Card>
    );
  }

  const { draft } = request;
  return (
    <Card className="mx-auto max-w-xl">
      <CardHeader>
        <CardTitle>{t("title", { name: draft.name })}</CardTitle>
        <CardDescription>{t("intro", { email: request.founder.email })}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <dl className="grid gap-3 text-sm">
          {draft.tagline && (
            <div>
              <dt className="text-muted-foreground">{t("tagline")}</dt>
              <dd>{draft.tagline}</dd>
            </div>
          )}
          <div>
            <dt className="text-muted-foreground">{t("purpose")}</dt>
            <dd className="whitespace-pre-line">{draft.purpose}</dd>
          </div>
        </dl>
        <ConfirmCommunityForm token={token} slug={draft.slug} slugTaken={await isCommunitySlugTaken(draft.slug)} />
      </CardContent>
    </Card>
  );
}
