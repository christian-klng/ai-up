import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Link as LinkIcon, Users } from "lucide-react";
import { getAccount } from "@/server/auth/session";
import { getMembership } from "@/server/domain/communities";
import { resolveCommunityInvite } from "@/server/domain/community-invites";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BrandLogo } from "@/components/shell/brand-logo";
import { JoinForm } from "./join-form";
import { JoinButton } from "./join-button";

export async function generateMetadata({ params }: PageProps<"/join/[token]">): Promise<Metadata> {
  const { token } = await params;
  const resolved = await resolveCommunityInvite(token);
  return resolved ? { title: resolved.community.name } : {};
}

/**
 * Public landing page of a community's join link.
 *
 * Three cases: a signed-in member is forwarded into the community; a signed-in stranger is offered a
 * one-click join; a visitor registers with name and e-mail and is active right away. The page shows
 * the *target* community's name, logo and purpose, while the frame keeps the operator's branding –
 * until a community can have its own domain (phase C2), the operator owns the host.
 */
export default async function JoinPage({ params }: PageProps<"/join/[token]">) {
  const { token } = await params;
  const [resolved, account, t] = await Promise.all([resolveCommunityInvite(token), getAccount(), getTranslations("auth.join")]);

  if (!resolved) {
    return (
      <Card className="mx-auto max-w-md">
        <CardHeader>
          <LinkIcon className="size-8 text-muted-foreground" aria-hidden />
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

  const { community } = resolved;

  // Already a member: nothing to decide – the join action only has to switch the active community.
  if (account && account.status === "active") {
    const membership = await getMembership(community.id, account.id);
    if (membership?.status === "active") redirect(`/join/${token}/open`);
  }

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <div className="flex items-center gap-3">
          <BrandLogo settings={community} size={40} />
          <div className="min-w-0">
            <CardTitle className="truncate">{community.name}</CardTitle>
            {community.tagline && <CardDescription className="truncate">{community.tagline}</CardDescription>}
          </div>
        </div>
        <CardDescription className="pt-2">{t("intro", { community: community.name })}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {community.purpose && (
          <p className="flex gap-2 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
            <Users className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="whitespace-pre-line">{community.purpose.slice(0, 600)}</span>
          </p>
        )}
        {account && account.status === "active" ? <JoinButton token={token} community={community.name} /> : <JoinForm token={token} />}
      </CardContent>
    </Card>
  );
}
