import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { LinkIcon } from "lucide-react";
import { getCurrentUser } from "@/server/auth/session";
import { resolveInvite, type ResolvedInvite } from "@/server/domain/invites";
import { getAppSettings } from "@/server/domain/settings";
import { getMedia } from "@/server/media/storage";
import { env } from "@/server/env";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { MeetingCover, MeetingFacts, MeetingHeader, MeetingLayout } from "@/components/meetings/meeting-detail";
import { InviteForm } from "./invite-form";

/** Date line for the OpenGraph description. */
async function startsAtLabel(resolved: ResolvedInvite): Promise<string | null> {
  if (!resolved.meeting.startsAt) return null;
  const format = await getFormatter();
  return format.dateTime(resolved.meeting.startsAt, { dateStyle: "long", timeStyle: "short" });
}

/**
 * The invite link is the only public meeting URL, so this is where social previews come from:
 * title, description with date and space, and the cover image (ideally 1200×630).
 */
export async function generateMetadata({ params }: PageProps<"/invite/[token]">): Promise<Metadata> {
  const { token } = await params;
  const [resolved, settings] = await Promise.all([resolveInvite(token), getAppSettings()]);
  if (!resolved) return { title: settings.name, robots: { index: false } };
  const when = await startsAtLabel(resolved);
  const description = [when, resolved.space.name, resolved.meeting.description].filter(Boolean).join(" · ").slice(0, 300);
  const cover = resolved.meeting.coverMediaId ? await getMedia(resolved.meeting.coverMediaId) : undefined;
  const images = cover ? [{ url: `${env.APP_URL}/api/files/${cover.id}`, width: cover.width ?? undefined, height: cover.height ?? undefined, alt: resolved.meeting.title }] : undefined;
  return {
    title: { absolute: `${resolved.meeting.title} · ${settings.name}` },
    description,
    robots: { index: false },
    openGraph: { type: "website", siteName: settings.name, title: resolved.meeting.title, description, url: `${env.APP_URL}/invite/${token}`, images },
    twitter: { card: images ? "summary_large_image" : "summary", title: resolved.meeting.title, description, images: images?.map((i) => i.url) },
  };
}

/**
 * Public landing page of a meeting invite link – the meeting page without members-only parts
 * (participants, recording, protocol). Signed-in members go straight to the meeting; everyone else
 * registers in the details card (and is activated right away) or signs in with the meeting as target.
 */
export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const [resolved, user, t] = await Promise.all([resolveInvite(token), getCurrentUser(), getTranslations("auth.invite")]);

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

  if (user) redirect(user.status === "active" ? resolved.href : "/pending");

  const settings = await getAppSettings();
  const { meeting, host, space } = resolved;
  return (
    <article>
      <MeetingCover mediaId={meeting.coverMediaId} className="mb-6" />
      <MeetingLayout
        header={<MeetingHeader status={meeting.status} startsAt={meeting.startsAt} kind={meeting.kind} title={meeting.title} host={host} description={meeting.description} />}
        aside={
          <Card>
            <CardHeader>
              <CardTitle>{t("title", { app: settings.name })}</CardTitle>
              <CardDescription>{t("intro")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <MeetingFacts startsAt={meeting.startsAt} kind={meeting.kind} recordingEnabled={meeting.recordingEnabled} status={meeting.status} space={space} />
              <Separator />
              <InviteForm token={token} loginHref={`/login?next=${encodeURIComponent(resolved.href)}`} />
            </CardContent>
          </Card>
        }
      />
    </article>
  );
}
