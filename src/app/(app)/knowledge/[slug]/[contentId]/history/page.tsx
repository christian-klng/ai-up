import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { canEditContent, getAreaBySlug, getContent, listContentVersions } from "@/server/domain/knowledge";
import { PageHeader } from "@/components/common/page-header";
import { ContentBody } from "@/components/content/content-body";
import { TextDiff } from "@/components/content/text-diff";
import { UserAvatar } from "@/components/shell/user-avatar";
import { Badge } from "@/components/ui/badge";
import { RestoreButton } from "./restore-button";

export default async function ContentHistoryPage({ params, searchParams }: PageProps<"/knowledge/[slug]/[contentId]/history">) {
  const user = await requireUser();
  const { slug, contentId } = await params;
  const sp = await searchParams;
  const [area, content] = await Promise.all([getAreaBySlug(slug), getContent(contentId)]);
  if (!area || !content || content.areaId !== area.id) notFound();
  const [t, format, versions] = await Promise.all([getTranslations("knowledge"), getFormatter(), listContentVersions(content.id)]);
  const editable = canEditContent(user, content);
  const selectedId = typeof sp.v === "string" ? sp.v : versions[0]?.id;
  const selected = versions.find((v) => v.id === selectedId) ?? versions[0];
  const previous = selected ? versions.find((v) => v.versionNo === selected.versionNo - 1) : undefined;

  return (
    <div>
      <Link href={`/knowledge/${area.slug}/${content.id}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {t("history.back")}
      </Link>
      <PageHeader title={t("history.title", { title: content.title })} description={t("view.versions", { count: content.versionCount })} />

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <ol className="grid gap-1 self-start rounded-lg border bg-card p-2">
          {versions.map((v) => {
            const active = v.id === selected?.id;
            return (
              <li key={v.id}>
                <Link
                  href={`/knowledge/${area.slug}/${content.id}/history?v=${v.id}`}
                  className={`block rounded-md px-3 py-2 text-sm transition-colors ${active ? "bg-accent text-accent-foreground" : "hover:bg-accent/60"}`}
                  aria-current={active ? "true" : undefined}
                >
                  <span className="flex items-center gap-2">
                    <span className="font-medium">{t("view.version", { no: v.versionNo })}</span>
                    {v.id === content.currentVersionId && <Badge variant="secondary">{t("history.current")}</Badge>}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                    {v.createdByUser && <UserAvatar user={v.createdByUser} size={16} variant="thumb" />}
                    {t("history.changedBy", { name: v.createdByUser?.name ?? "–", date: format.dateTime(v.createdAt, { dateStyle: "medium", timeStyle: "short" }) })}
                  </span>
                  <span className="mt-0.5 block truncate text-xs italic text-muted-foreground">{v.changeNote ?? t("history.noNote")}</span>
                </Link>
              </li>
            );
          })}
        </ol>

        {selected && (
          <div className="grid gap-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">
                {t("view.version", { no: selected.versionNo })}: {selected.title}
              </h2>
              {editable && selected.id !== content.currentVersionId && (
                <RestoreButton contentId={content.id} versionId={selected.id} note={t("history.restoreNote", { no: selected.versionNo })} label={t("history.restore")} successLabel={t("history.restored")} />
              )}
            </div>

            {previous && (selected.bodyMarkdown || previous.bodyMarkdown) && (
              <section className="grid gap-2">
                <h3 className="text-sm font-medium text-muted-foreground">{t("history.diffWith", { no: previous.versionNo })}</h3>
                <TextDiff before={previous.bodyMarkdown ?? ""} after={selected.bodyMarkdown ?? ""} emptyLabel={t("history.noDiff")} />
              </section>
            )}

            <section className="rounded-lg border p-5">
              <ContentBody
                type={content.type}
                title={selected.title}
                bodyMarkdown={selected.bodyMarkdown}
                url={selected.url}
                media={selected.media}
                meta={selected.meta}
                labels={{ openLink: t("view.openLink"), downloadVideo: t("view.downloadVideo"), videoUnsupported: t("view.videoUnsupported") }}
              />
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
