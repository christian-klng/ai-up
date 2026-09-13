import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { LinkIcon } from "lucide-react";
import { getCurrentUser } from "@/server/auth/session";
import { resolveInvite } from "@/server/domain/invites";
import { getAppSettings } from "@/server/domain/settings";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InviteForm } from "./invite-form";

/**
 * Public landing page of a meeting invite link. Signed-in members go straight to the meeting;
 * everyone else registers here (and is activated right away) or signs in with the meeting as target.
 */
export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const [resolved, user, t] = await Promise.all([resolveInvite(token), getCurrentUser(), getTranslations("auth.invite")]);

  if (!resolved) {
    return (
      <Card>
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

  if (user) redirect(user.status === "active" ? resolved.href : "/pending");

  const [settings, format] = await Promise.all([getAppSettings(), getFormatter()]);
  const startsAt = resolved.meeting.startsAt ? format.dateTime(resolved.meeting.startsAt, { dateStyle: "long", timeStyle: "short" }) : null;
  return <InviteForm token={token} appName={settings.name} meetingTitle={resolved.meeting.title} spaceName={resolved.space.name} startsAt={startsAt} loginHref={`/login?next=${encodeURIComponent(resolved.href)}`} />;
}
