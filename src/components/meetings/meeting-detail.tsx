import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import { CalendarClock, Clock, Users } from "lucide-react";
import type { MeetingKind, MeetingStatus } from "@/server/db/schema";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/shell/user-avatar";
import { AreaIcon } from "@/components/knowledge/area-icon";
import { MeetingKindIcon, MeetingStatusBadge } from "./meeting-badges";

/**
 * Building blocks of the meeting page, shared by the member view (/meetings/…) and the public
 * invite page (/invite/<token>): cover on top, a big title with host and description on the left,
 * and the fact list (date tile, kind, space) for the card in the right column. Server components –
 * they format dates with the app locale and time zone.
 */

type Host = { id: string; name: string; avatarMediaId: string | null };

/** Two-column frame: header and content on the left, the aside (details card) on the right. On small
 *  screens the aside sits between header and content so the action buttons stay near the top. */
export function MeetingLayout({ header, aside, children }: { header: React.ReactNode; aside: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-8">
      <div className="min-w-0 lg:col-start-1">{header}</div>
      <aside className="grid gap-4 self-start lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1">{aside}</aside>
      {children && <div className="grid min-w-0 gap-4 lg:col-start-1">{children}</div>}
    </div>
  );
}

export function MeetingCover({ mediaId, className }: { mediaId: string | null; className?: string }) {
  if (!mediaId) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={`/api/files/${mediaId}`} alt="" className={cn("aspect-[1200/630] w-full rounded-xl border object-cover", className)} />;
}

/** Scheduled with a start that is still ahead (evaluated at render time on the server). */
function startsAhead(status: MeetingStatus, startsAt: Date | null): startsAt is Date {
  return status === "scheduled" && !!startsAt && startsAt.getTime() > Date.now();
}

/** Status pill: live, "starts in 2 weeks" for dated upcoming meetings, otherwise the plain status. */
export async function MeetingStatusPill({ status, startsAt }: { status: MeetingStatus; startsAt: Date | null }) {
  const [t, format] = await Promise.all([getTranslations("meetings"), getFormatter()]);
  const label = startsAhead(status, startsAt) ? t("startsRelative", { rel: format.relativeTime(startsAt) }) : t(`status.${status}`);
  return <MeetingStatusBadge status={status} label={label} />;
}

export async function MeetingHeader({ status, startsAt, kind, title, host, description, actions }: { status: MeetingStatus; startsAt: Date | null; kind: MeetingKind; title: string; host: Host | null; description: string | null; actions?: React.ReactNode }) {
  const t = await getTranslations("meetings");
  return (
    <header>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <MeetingStatusPill status={status} startsAt={startsAt} />
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <MeetingKindIcon kind={kind} className="size-3.5" /> {t(`kinds.${kind}`)}
        </span>
      </div>
      <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h1>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        {host ? (
          <div className="flex items-center gap-3">
            <UserAvatar user={host} size={40} />
            <div className="leading-tight">
              <div className="text-xs text-muted-foreground">{t("hostedBy")}</div>
              <div className="text-sm font-medium">{host.name}</div>
            </div>
          </div>
        ) : (
          <span />
        )}
        {actions && <div className="flex items-center gap-1">{actions}</div>}
      </div>
      {description && <p className="mt-5 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">{description}</p>}
    </header>
  );
}

/** Date tile plus weekday, date and time (with zone); "date to follow" while scheduled without one. */
export async function MeetingDateRow({ startsAt, status }: { startsAt: Date | null; status: MeetingStatus }) {
  const [t, format] = await Promise.all([getTranslations("meetings"), getFormatter()]);
  if (!startsAt) {
    if (status !== "scheduled") return null;
    return (
      <FactRow icon={<CalendarClock className="size-4" aria-hidden />}>
        <span className="text-muted-foreground">{t("noDate")}</span>
      </FactRow>
    );
  }
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-14 shrink-0 flex-col items-center justify-center rounded-lg border bg-muted/40 leading-none" aria-hidden>
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{format.dateTime(startsAt, { month: "short" }).replace(".", "")}</span>
        <span className="mt-0.5 text-xl font-semibold tabular-nums">{format.dateTime(startsAt, { day: "numeric" })}</span>
      </div>
      <div className="min-w-0 leading-snug">
        <div className="font-medium">{format.dateTime(startsAt, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
        <div className="text-sm text-muted-foreground">{format.dateTime(startsAt, { hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}</div>
      </div>
    </div>
  );
}

/** The fact list of the details card. `spaceHref` links the space for members; the public page passes none. */
export async function MeetingFacts({ startsAt, startedAt, kind, recordingEnabled, status, endedAt, participantCount, space, spaceHref }: { startsAt: Date | null; /** actual start of a live/ended call, shown when no date was planned */ startedAt?: Date | null; kind: MeetingKind; recordingEnabled: boolean; status: MeetingStatus; endedAt?: Date | null; participantCount?: number; space: { name: string; icon: string }; spaceHref?: string }) {
  const [t, format] = await Promise.all([getTranslations("meetings"), getFormatter()]);
  return (
    <div className="grid gap-3">
      <MeetingDateRow startsAt={startsAt ?? (status !== "scheduled" ? (startedAt ?? null) : null)} status={status} />
      <FactRow icon={<MeetingKindIcon kind={kind} />}>
        <div>{t(`kinds.${kind}`)}</div>
        {kind !== "protocol" && <div className="text-xs text-muted-foreground">{recordingEnabled ? t("recordingOn") : t("recordingOff")}</div>}
      </FactRow>
      <FactRow icon={<AreaIcon icon={space.icon} className="size-4" />}>
        {spaceHref ? (
          <Link href={spaceHref} className="font-medium text-primary hover:underline">
            {space.name}
          </Link>
        ) : (
          <span>{space.name}</span>
        )}
      </FactRow>
      {status === "live" && participantCount !== undefined && (
        <FactRow icon={<Users className="size-4" aria-hidden />}>
          <span className="text-emerald-700 dark:text-emerald-300">{t("participants", { count: participantCount })}</span>
        </FactRow>
      )}
      {status === "ended" && endedAt && (
        <FactRow icon={<Clock className="size-4" aria-hidden />}>
          <span className="text-muted-foreground">{t("endedAt", { date: format.dateTime(endedAt, { dateStyle: "medium", timeStyle: "short" }) })}</span>
        </FactRow>
      )}
    </div>
  );
}

function FactRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/40 text-muted-foreground">{icon}</span>
      <div className="min-w-0 self-center leading-snug">{children}</div>
    </div>
  );
}

type Participant = { id: string; identity: string; displayName: string | null; user: Host | null };

/** Chips of the people in (or once in) the call – members only, never on the public page. */
export function ParticipantChips({ participants }: { participants: Participant[] }) {
  return (
    <ul className="flex flex-wrap gap-2">
      {participants.map((p) => (
        <li key={p.id} className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs">
          {p.user && <UserAvatar user={p.user} size={16} variant="thumb" />}
          {p.user?.name ?? p.displayName ?? p.identity}
        </li>
      ))}
    </ul>
  );
}
