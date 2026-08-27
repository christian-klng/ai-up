import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeft, ChevronRight, History } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { canEditMeeting, getMeeting, getSpaceBySlug, listParticipants, listRecordings } from "@/server/domain/meetings";
import { getLiveKitConfig } from "@/server/domain/integrations";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/shell/user-avatar";
import { MeetingActions } from "@/components/meetings/meeting-actions";
import { MeetingKindIcon, MeetingStatusBadge } from "@/components/meetings/meeting-badges";
import { ProtocolEditor } from "@/components/meetings/protocol-editor";
import { CallPanel } from "@/components/meetings/call-panel";
import { Markdown } from "@/components/content/markdown";

export default async function MeetingDetailPage({ params }: PageProps<"/meetings/[slug]/[id]">) {
  const user = await requireUser();
  const { slug, id } = await params;
  const [space, meeting] = await Promise.all([getSpaceBySlug(slug), getMeeting(id)]);
  if (!space || !meeting || meeting.spaceId !== space.id) notFound();
  const [t, format, participants, recordings, lk] = await Promise.all([getTranslations("meetings"), getFormatter(), listParticipants(meeting.id), listRecordings(meeting.id), getLiveKitConfig()]);
  const editable = canEditMeeting(user, meeting);
  const callsAvailable = !!lk?.enabled;

  return (
    <article className="mx-auto max-w-4xl">
      <Link href={`/meetings/${space.slug}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {space.name}
      </Link>
      <PageHeader
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2">
              <MeetingKindIcon kind={meeting.kind} className="size-6 text-muted-foreground" /> {meeting.title}
            </span>
            <MeetingStatusBadge status={meeting.status} label={t(`status.${meeting.status}`)} />
          </span>
        }
        description={meeting.description ?? undefined}
        actions={
          <div className="flex items-center gap-1">
            <Button asChild variant="ghost" size="sm">
              <Link href={`/meetings/${space.slug}/${meeting.id}/history`}>
                <History className="size-4" /> {t("protocol.history")}
              </Link>
            </Button>
            {editable && (
              <MeetingActions
                meeting={{ id: meeting.id, title: meeting.title, description: meeting.description, kind: meeting.kind, startsAt: meeting.startsAt?.toISOString() ?? null, recordingEnabled: meeting.recordingEnabled, status: meeting.status }}
                spaceId={space.id}
                spaceSlug={space.slug}
                recordingDefault={space.recordingDefault}
                callsAvailable={callsAvailable}
              />
            )}
          </div>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span>{t(`kinds.${meeting.kind}`)}</span>
        {meeting.startsAt && <span>· {t("startsAtLabel", { date: format.dateTime(meeting.startsAt, { dateStyle: "long", timeStyle: "short" }) })}</span>}
        {meeting.host && (
          <span className="inline-flex items-center gap-1.5">
            · <UserAvatar user={meeting.host} size={18} variant="thumb" /> {t("host", { name: meeting.host.name })}
          </span>
        )}
        {meeting.kind !== "protocol" && <span>· {meeting.recordingEnabled ? t("recordingOn") : t("recordingOff")}</span>}
      </div>

      {meeting.kind !== "protocol" && (
        <div className="mb-6 grid gap-4">
          <CallPanel
            meetingId={meeting.id}
            callHref={`/meetings/${space.slug}/${meeting.id}/call`}
            status={meeting.status}
            kind={meeting.kind}
            canHost={editable}
            callsAvailable={callsAvailable}
            participantCount={meeting.participantCount}
            recording={{ enabled: meeting.recordingEnabled, status: meeting.recordingStatus, error: meeting.recordingError }}
            participants={(meeting.status === "live" ? participants.filter((p) => !p.leftAt) : dedupe(participants)).map((p) => ({ id: p.id, identity: p.identity, displayName: p.displayName, user: p.user }))}
          />
          {recordings.length > 0 && (
            <section className="rounded-lg border bg-card p-5">
              <h3 className="mb-2 text-sm font-medium">{t("recording")}</h3>
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
          {meeting.transcriptMarkdown && (
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
        </div>
      )}

      <section className="rounded-lg border bg-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">{t("protocol.title")}</h2>
          {meeting.protocolVersion > 0 && <span className="text-xs text-muted-foreground">{t("protocol.version", { no: meeting.protocolVersion })}</span>}
        </div>
        <ProtocolEditor meetingId={meeting.id} initialBody={meeting.protocolMarkdown ?? ""} version={meeting.protocolVersion} />
      </section>
    </article>
  );
}

/** One chip per person for past meetings (people may have joined several times). */
function dedupe<T extends { identity: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((p) => (seen.has(p.identity) ? false : (seen.add(p.identity), true)));
}
