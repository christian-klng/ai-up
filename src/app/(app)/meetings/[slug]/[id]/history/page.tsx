import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { getMeeting, getSpaceBySlug, listProtocolVersions } from "@/server/domain/meetings";
import { PageHeader } from "@/components/common/page-header";
import { TextDiff } from "@/components/content/text-diff";
import { Markdown } from "@/components/content/markdown";
import { UserAvatar } from "@/components/shell/user-avatar";
import { Badge } from "@/components/ui/badge";
import { RestoreProtocolButton } from "@/components/meetings/restore-protocol-button";

export default async function ProtocolHistoryPage({ params, searchParams }: PageProps<"/meetings/[slug]/[id]/history">) {
  await requireUser();
  const { slug, id } = await params;
  const sp = await searchParams;
  const [space, meeting] = await Promise.all([getSpaceBySlug(slug), getMeeting(id)]);
  if (!space || !meeting || meeting.spaceId !== space.id) notFound();
  const [t, format, versions] = await Promise.all([getTranslations("meetings.protocol"), getFormatter(), listProtocolVersions(meeting.id)]);
  const selectedId = typeof sp.v === "string" ? sp.v : versions[0]?.id;
  const selected = versions.find((v) => v.id === selectedId) ?? versions[0];
  const previous = selected ? versions.find((v) => v.versionNo === selected.versionNo - 1) : undefined;

  return (
    <div>
      <Link href={`/meetings/${space.slug}/${meeting.id}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {meeting.title}
      </Link>
      <PageHeader title={t("historyTitle", { title: meeting.title })} description={t("versions", { count: versions.length })} />
      {versions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noVersions")}</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          <ol className="grid gap-1 self-start rounded-lg border bg-card p-2">
            {versions.map((v) => {
              const active = v.id === selected?.id;
              return (
                <li key={v.id}>
                  <Link href={`/meetings/${space.slug}/${meeting.id}/history?v=${v.id}`} className={`block rounded-md px-3 py-2 text-sm transition-colors ${active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"}`} aria-current={active ? "true" : undefined}>
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{t("version", { no: v.versionNo })}</span>
                      {v.versionNo === meeting.protocolVersion && <Badge variant="secondary">{t("current")}</Badge>}
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      {v.createdByUser && <UserAvatar user={v.createdByUser} size={16} variant="thumb" />}
                      {v.createdByUser?.name ?? "–"}, {format.dateTime(v.createdAt, { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                    <span className="mt-0.5 block truncate text-xs italic text-muted-foreground">{v.changeNote ?? t("noNote")}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
          {selected && (
            <div className="grid gap-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">{t("version", { no: selected.versionNo })}</h2>
                {selected.versionNo !== meeting.protocolVersion && <RestoreProtocolButton meetingId={meeting.id} versionId={selected.id} note={t("restoreNote", { no: selected.versionNo })} label={t("restore")} successLabel={t("restored")} />}
              </div>
              {previous && (
                <section className="grid gap-2">
                  <h3 className="text-sm font-medium text-muted-foreground">{t("diffWith", { no: previous.versionNo })}</h3>
                  <TextDiff before={previous.body} after={selected.body} emptyLabel={t("noDiff")} />
                </section>
              )}
              <section className="rounded-lg border p-5">
                <Markdown>{selected.body}</Markdown>
              </section>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
