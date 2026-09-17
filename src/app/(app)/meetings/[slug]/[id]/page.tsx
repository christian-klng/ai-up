import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeft, ChevronRight, History } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { canEditMeeting, getMeeting, getSpaceBySlug, listParticipants, listRecordings } from "@/server/domain/meetings";
import { getLiveKitConfig } from "@/server/domain/integrations";
import { getMeetingInvite, markInviteLanded, meetingHref, pendingInviteRedirect } from "@/server/domain/invites";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { MeetingActions } from "@/components/meetings/meeting-actions";
import { MeetingCover, MeetingFacts, MeetingHeader, MeetingLayout, ParticipantChips } from "@/components/meetings/meeting-detail";
import { ProtocolEditor } from "@/components/meetings/protocol-editor";
import { CallActions } from "@/components/meetings/call-actions";
import { Markdown } from "@/components/content/markdown";

export async function generateMetadata({ params }: PageProps<"/meetings/[slug]/[id]">): Promise<Metadata> {
  const { id } = await params;
  const me = await requireUser();
  const meeting = await getMeeting(me.communityId, id);
  return meeting ? { title: meeting.title } : {};
}

export default async function MeetingDetailPage({ params }: PageProps<"/meetings/[slug]/[id]">) {
  const user = await requireUser();
  const { slug, id } = await params;
  const [space, meeting] = await Promise.all([getSpaceBySlug(user.communityId, slug), getMeeting(user.communityId, id)]);
  if (!space || !meeting || meeting.spaceId !== space.id) notFound();
  const isAdmin = user.role === "admin";
  const [t, format, participants, recordings, lk, invite] = await Promise.all([
    getTranslations("meetings"),
    getFormatter(),
    listParticipants(meeting.id),
    listRecordings(meeting.id),
    getLiveKitConfig(),
    isAdmin ? getMeetingInvite(meeting.id) : Promise.resolve(undefined),
  ]);
  const editable = canEditMeeting(user, meeting);
  // An invited member arriving at their meeting has reached the target – no redirect from /home later.
  if (user.membership.invitedViaId && !user.membership.inviteLandedAt) {
    const target = await pendingInviteRedirect(user.membership);
    if (!target || target === meetingHref(space.slug, meeting.id)) await markInviteLanded(user.communityId, user.id);
  }
  const callsAvailable = !!lk?.enabled;
  const callKind = meeting.kind === "protocol" ? null : meeting.kind;
  const isCall = callKind !== null;
  const people = (meeting.status === "live" ? participants.filter((p) => !p.leftAt) : dedupe(participants)).map((p) => ({ id: p.id, identity: p.identity, displayName: p.displayName, user: p.user }));

  return (
    <article className="mx-auto max-w-5xl">
      <Link href={`/meetings/${space.slug}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {space.name}
      </Link>
      <MeetingCover mediaId={meeting.coverMediaId} className="mb-6" />
      <MeetingLayout
        header={
          <MeetingHeader
            status={meeting.status}
            startsAt={meeting.startsAt}
            kind={meeting.kind}
            title={meeting.title}
            host={meeting.host}
            description={meeting.description}
            actions={
              <>
                <Button asChild variant="ghost" size="sm">
                  <Link href={`/meetings/${space.slug}/${meeting.id}/history`}>
                    <History className="size-4" /> {t("protocol.history")}
                  </Link>
                </Button>
                {editable && (
                  <MeetingActions
                    meeting={{ id: meeting.id, title: meeting.title, description: meeting.description, kind: meeting.kind, startsAt: meeting.startsAt?.toISOString() ?? null, recordingEnabled: meeting.recordingEnabled, status: meeting.status, coverMediaId: meeting.coverMediaId }}
                    spaceId={space.id}
                    spaceSlug={space.slug}
                    recordingDefault={space.recordingDefault}
                    callsAvailable={callsAvailable}
                    invite={isAdmin ? (invite ? { url: invite.url, enabled: invite.enabled, useCount: invite.useCount } : { url: null, enabled: false, useCount: 0 }) : null}
                  />
                )}
              </>
            }
          />
        }
        aside={
          <>
            <Card>
              <CardContent className="grid gap-4">
                <MeetingFacts startsAt={meeting.startsAt} startedAt={meeting.startedAt} kind={meeting.kind} recordingEnabled={meeting.recordingEnabled} status={meeting.status} endedAt={meeting.endedAt} participantCount={meeting.participantCount} space={space} spaceHref={`/meetings/${space.slug}`} />
                {callKind && (
                  <>
                    <Separator />
                    <CallActions
                      meetingId={meeting.id}
                      callHref={`/meetings/${space.slug}/${meeting.id}/call`}
                      status={meeting.status}
                      kind={callKind}
                      canHost={editable}
                      callsAvailable={callsAvailable}
                      recording={{ enabled: meeting.recordingEnabled, status: meeting.recordingStatus, error: meeting.recordingError }}
                    />
                  </>
                )}
              </CardContent>
            </Card>
            {isCall && people.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">{meeting.status === "live" ? t("call.inCall") : t("call.wasInCall")}</CardTitle>
                </CardHeader>
                <CardContent>
                  <ParticipantChips participants={people} />
                </CardContent>
              </Card>
            )}
          </>
        }
      >
        {isCall && recordings.length > 0 && (
          <section className="rounded-lg border bg-card p-5">
            <h2 className="mb-2 text-sm font-medium">{t("recording")}</h2>
            <div className="grid gap-3">
              {recordings.map((r) => (
                <div key={r.id}>
                  {recordings.length > 1 && (
                    <div className="mb-1 text-xs text-muted-foreground">{t("recordingFrom", { date: format.dateTime(r.createdAt, { dateStyle: "medium", timeStyle: "short" }) })}</div>
                  )}
                  <audio controls preload="metadata" src={`/api/files/${r.mediaId}`} className="w-full" />
                </div>
              ))}
            </div>
          </section>
        )}
        {isCall && meeting.transcriptMarkdown && (
          <details className="group rounded-lg border bg-card p-5">
            <summary className="cursor-pointer list-none text-sm font-medium">
              <span className="inline-flex items-center gap-1.5">
                <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" /> {t("transcript")}
              </span>
            </summary>
            <div className="mt-3">
              <Markdown className="prose-sm">{meeting.transcriptMarkdown}</Markdown>
            </div>
          </details>
        )}
        <section className="rounded-lg border bg-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">{t("protocol.title")}</h2>
            {meeting.protocolVersion > 0 && <span className="text-xs text-muted-foreground">{t("protocol.version", { no: meeting.protocolVersion })}</span>}
          </div>
          <ProtocolEditor meetingId={meeting.id} initialBody={meeting.protocolMarkdown ?? ""} version={meeting.protocolVersion} />
        </section>
      </MeetingLayout>
    </article>
  );
}

/** One chip per person for past meetings (people may have joined several times). */
function dedupe<T extends { identity: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((p) => (seen.has(p.identity) ? false : (seen.add(p.identity), true)));
}
