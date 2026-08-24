import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { canEditContent, getAreaBySlug, getContent } from "@/server/domain/knowledge";
import { getStructureByAreaId } from "@/server/domain/structures";
import { env } from "@/server/env";
import { PageHeader } from "@/components/common/page-header";
import { ContentEditor } from "@/components/content/content-editor";
import { StructureFillForm } from "@/components/structures/structure-fill-form";

export default async function EditContentPage({ params }: PageProps<"/knowledge/[slug]/[contentId]/edit">) {
  const user = await requireUser();
  const { slug, contentId } = await params;
  const [area, content] = await Promise.all([getAreaBySlug(slug), getContent(contentId)]);
  if (!area || !content || content.areaId !== area.id) notFound();
  if (!canEditContent(user, content)) redirect(`/knowledge/${slug}/${contentId}`);
  const v = content.version;
  const m = content.media;

  if (content.type === "structured") {
    const structureMeta = v?.meta.structure;
    if (!structureMeta) notFound();
    const [ts, structure] = await Promise.all([getTranslations("knowledge.structured"), getStructureByAreaId(area.id)]);
    const changed = structure ? structure.version > structureMeta.structureVersion : true;
    return (
      <div className="mx-auto max-w-3xl">
        <Link href={`/knowledge/${area.slug}/${content.id}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> {content.title}
        </Link>
        <PageHeader title={ts("editTitle")} />
        {changed && <p className="mb-4 rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-sm">{ts("structureChanged")}</p>}
        <StructureFillForm def={structureMeta.definition} mode="edit" areaId={area.id} areaSlug={area.slug} contentId={content.id} initialTitle={content.title} initialAnswers={structureMeta.answers} />
      </div>
    );
  }

  const t = await getTranslations("knowledge.editor");
  return (
    <div className="mx-auto max-w-3xl">
      <Link href={`/knowledge/${area.slug}/${content.id}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {content.title}
      </Link>
      <PageHeader title={t("editTitle")} />
      <ContentEditor
        areaId={area.id}
        areaSlug={area.slug}
        maxUploadMb={env.MAX_UPLOAD_MB}
        initial={{
          contentId: content.id,
          type: content.type,
          title: content.title,
          body: v?.bodyMarkdown ?? "",
          url: v?.url ?? "",
          alt: v?.meta.alt ?? "",
          media: m
            ? { id: m.id, kind: m.kind, mime: m.mime, size: m.size, width: m.width, height: m.height, originalName: m.originalName, url: `/api/files/${m.id}`, thumbUrl: m.variants.thumb ? `/api/files/${m.id}?v=thumb` : null }
            : null,
        }}
      />
    </div>
  );
}
