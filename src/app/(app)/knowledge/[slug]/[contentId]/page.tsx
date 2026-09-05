import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeft, History, Pencil } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { canEditContent, getAreaBySlug, getContent } from "@/server/domain/knowledge";
import { getEvaluationSummary } from "@/server/domain/evaluation";
import { ContentBody } from "@/components/content/content-body";
import { ImageLightbox } from "@/components/content/image-lightbox";
import { StructuredContentView } from "@/components/structures/structured-content-view";
import { EvaluationPopover } from "@/components/knowledge/evaluation-popover";
import { UserAvatar } from "@/components/shell/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ContentActions } from "./content-actions";

export default async function ContentPage({ params }: PageProps<"/knowledge/[slug]/[contentId]">) {
  const user = await requireUser();
  const { slug, contentId } = await params;
  const [area, content] = await Promise.all([getAreaBySlug(slug), getContent(contentId)]);
  if (!area || !content || content.areaId !== area.id) notFound();
  const [t, format] = await Promise.all([getTranslations("knowledge"), getFormatter()]);
  const v = content.version;
  const editable = canEditContent(user, content);
  const evaluation = await getEvaluationSummary(content.id, content.currentVersionId, v?.meta.structure?.structureId ?? null);

  return (
    <article className="mx-auto max-w-3xl">
      <Link href={`/knowledge/${area.slug}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {area.name}
      </Link>

      <header className="mb-6 grid gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">{content.title}</h1>
          <div className="flex items-center gap-1">
            <Button asChild variant="ghost" size="sm">
              <Link href={`/knowledge/${area.slug}/${content.id}/history`}>
                <History className="size-4" /> {t("view.history")}
              </Link>
            </Button>
            {editable && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/knowledge/${area.slug}/${content.id}/edit`}>
                  <Pencil className="size-4" /> {t("view.edit")}
                </Link>
              </Button>
            )}
            {evaluation && (
              <EvaluationPopover
                contentId={content.id}
                rows={evaluation.rows.map((r) => ({ key: r.criterionKey, title: r.criterionTitle, status: r.status, reason: r.reason, checkedAt: r.createdAt.toISOString() }))}
                pending={evaluation.pending}
                criteriaCount={evaluation.criteriaCount}
                canRecheck={editable}
              />
            )}
            <ContentActions contentId={content.id} areaSlug={area.slug} pinned={content.pinned} canEdit={editable} isAdmin={user.role === "admin"} markdown={v?.bodyMarkdown ?? null} title={content.title} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <Badge variant="secondary">{t(`types.${content.type}`)}</Badge>
          {content.author && (
            <span className="inline-flex items-center gap-1.5">
              <UserAvatar user={content.author} size={20} variant="thumb" />
              {t("view.createdBy", { name: content.author.name, date: format.dateTime(content.createdAt, { dateStyle: "medium" }) })}
            </span>
          )}
          {content.versionCount > 1 && (
            <span>
              · {t("view.versions", { count: content.versionCount })} · {t("view.lastEdited", { date: format.dateTime(content.updatedAt, { dateStyle: "medium", timeStyle: "short" }) })}
            </span>
          )}
        </div>
      </header>

      {content.type === "structured" && content.media?.kind === "image" && (
        <div className="mb-6">
          <ImageLightbox src={`/api/files/${content.media.id}`} alt={content.title} enlargeLabel={t("view.enlargeImage")} />
        </div>
      )}

      {v && content.type === "structured" && v.meta.structure ? (
        <StructuredContentView meta={v.meta.structure} />
      ) : (
        v && (
          <ContentBody
            type={content.type}
            title={content.title}
            bodyMarkdown={v.bodyMarkdown}
            url={v.url}
            media={content.media}
            meta={v.meta}
            labels={{ openLink: t("view.openLink"), downloadVideo: t("view.downloadVideo"), videoUnsupported: t("view.videoUnsupported") }}
          />
        )
      )}
    </article>
  );
}
