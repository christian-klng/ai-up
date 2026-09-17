import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowRight, CalendarClock } from "lucide-react";
import { redirect } from "next/navigation";
import { requireCommunity, requireUser } from "@/server/auth/session";
import { markInviteLanded, pendingInviteRedirect } from "@/server/domain/invites";
import { listUpcomingMeetings } from "@/server/domain/meetings";
import { countMembersByStatus } from "@/server/domain/users";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { UserAvatar } from "@/components/shell/user-avatar";
import { MeetingKindIcon, MeetingStatusBadge } from "@/components/meetings/meeting-badges";

export default async function HomePage() {
  const user = await requireUser();
  // Members who registered through a meeting invite land on that meeting once.
  const inviteHref = await pendingInviteRedirect(user.membership);
  if (inviteHref) {
    await markInviteLanded(user.communityId, user.id);
    redirect(inviteHref);
  }
  const [t, tm, format, settings, upcoming] = await Promise.all([getTranslations("home"), getTranslations("meetings"), getFormatter(), requireCommunity(), listUpcomingMeetings(user.communityId, 6)]);
  const counts = user.role === "admin" ? await countMembersByStatus(user.communityId) : null;

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

      {upcoming.length > 0 && (
        <section className="mb-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">{t("upcomingTitle")}</h2>
            <Link href="/meetings" className="text-sm text-muted-foreground hover:text-foreground">
              {t("allMeetings")}
            </Link>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2">
            {upcoming.map((m) => (
              <li key={m.id}>
                <Link href={`/meetings/${m.spaceSlug}/${m.id}`} className="flex h-full flex-col overflow-hidden rounded-lg border bg-card transition-colors hover:bg-accent/40">
                  {m.coverMediaId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/files/${m.coverMediaId}`} alt="" className="aspect-[1200/630] w-full object-cover" />
                  ) : (
                    <div className="flex aspect-[1200/630] w-full items-center justify-center bg-muted text-muted-foreground">
                      <MeetingKindIcon kind={m.kind} className="size-8" />
                    </div>
                  )}
                  <div className="grid flex-1 gap-1.5 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{m.title}</span>
                      {m.status === "live" && <MeetingStatusBadge status="live" label={tm("status.live")} />}
                    </div>
                    <div className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                      <CalendarClock className="size-4 shrink-0" aria-hidden />
                      {m.startsAt ? format.dateTime(m.startsAt, { dateStyle: "medium", timeStyle: "short" }) : tm("status.live")}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {m.spaceName} · {tm(`kinds.${m.kind}`)}
                    </div>
                    {m.host && (
                      <div className="mt-auto flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
                        <UserAvatar user={m.host} size={18} variant="thumb" /> {m.host.name}
                      </div>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
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
