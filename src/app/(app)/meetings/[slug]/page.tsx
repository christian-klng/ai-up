import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { requireUser } from "@/server/auth/session";
import { getSpaceBySlug, listMeetings } from "@/server/domain/meetings";
import { getLiveKitConfig } from "@/server/domain/integrations";
import { PageHeader } from "@/components/common/page-header";
import { UserAvatar } from "@/components/shell/user-avatar";
import { MeetingDialog } from "@/components/meetings/meeting-dialog";
import { MeetingKindIcon, MeetingStatusBadge } from "@/components/meetings/meeting-badges";
import { AreaIcon } from "@/components/knowledge/area-icon";
import type { MeetingListItem } from "@/server/domain/meetings";

export default async function MeetingSpacePage({ params }: PageProps<"/meetings/[slug]">) {
  await requireUser();
  const { slug } = await params;
  const space = await getSpaceBySlug(slug);
  if (!space) notFound();
  const [t, items, lk] = await Promise.all([getTranslations("meetings"), listMeetings({ spaceId: space.id }), getLiveKitConfig()]);
  const callsAvailable = !!lk?.enabled;
  const live = items.filter((m) => m.status === "live");
  const upcoming = items.filter((m) => m.status === "scheduled");
  const past = items.filter((m) => m.status === "ended");

  return (
    <div>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <AreaIcon icon={space.icon} className="size-6 text-primary" /> {space.name}
          </span>
        }
        description={space.purpose}
        actions={<MeetingDialog spaceId={space.id} recordingDefault={space.recordingDefault} callsAvailable={callsAvailable} />}
      />
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">{t("empty")}</div>
      ) : (
        <div className="grid gap-6">
          <MeetingSection title={t("sections.live")} list={live} spaceSlug={space.slug} />
          <MeetingSection title={t("sections.upcoming")} list={upcoming} spaceSlug={space.slug} />
          <MeetingSection title={t("sections.past")} list={past} spaceSlug={space.slug} />
        </div>
      )}
    </div>
  );
}

async function MeetingSection({ title, list, spaceSlug }: { title: string; list: MeetingListItem[]; spaceSlug: string }) {
  if (list.length === 0) return null;
  const [t, format] = await Promise.all([getTranslations("meetings"), getFormatter()]);
  return (
    <section className="grid gap-2">
      <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">{title}</h2>
      <ul className="divide-y rounded-lg border bg-card">
        {list.map((m) => (
          <li key={m.id}>
            <Link href={`/meetings/${spaceSlug}/${m.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-accent/40">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <MeetingKindIcon kind={m.kind} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{m.title}</span>
                  <MeetingStatusBadge status={m.status} label={t(`status.${m.status}`)} />
                  {m.status === "live" && m.participantCount > 0 && <span className="text-xs text-muted-foreground">{t("participants", { count: m.participantCount })}</span>}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t(`kinds.${m.kind}`)}
                  {m.startsAt && ` · ${format.dateTime(m.startsAt, { dateStyle: "medium", timeStyle: "short" })}`}
                  {m.status === "ended" && m.endedAt && ` · ${t("endedAt", { date: format.dateTime(m.endedAt, { dateStyle: "medium", timeStyle: "short" }) })}`}
                  {m.recording && ` · ${t("hasRecording")}`}
                </span>
              </span>
              {m.host && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <UserAvatar user={m.host} size={20} variant="thumb" /> {m.host.name}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
