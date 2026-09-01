import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { canEditContent, getAreaBySlug, getContent } from "@/server/domain/knowledge";
import { getTemplateById } from "@/server/domain/templates";
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
    // The upgrade offer compares against the entry's OWN template — a deleted
    // template simply means the entry keeps its snapshot forever.
    const [ts, template] = await Promise.all([getTranslations("knowledge.structured"), getTemplateById(structureMeta.structureId)]);
    const upgradeTo = template && template.version > structureMeta.structureVersion ? { version: template.version, definition: template.definition } : undefined;
    return (
      <div className="mx-auto max-w-3xl">
        <Link href={`/knowledge/${area.slug}/${content.id}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> {content.title}
        </Link>
        <PageHeader title={ts("editTitle")} />
        <StructureFillForm
          def={structureMeta.definition}
          mode="edit"
          areaId={area.id}
          areaSlug={area.slug}
          contentId={content.id}
          upgradeTo={upgradeTo}
          maxUploadMb={env.MAX_UPLOAD_MB}
          initialTitle={content.title}
          initialAnswers={structureMeta.answers}
          initialImageMediaId={m?.kind === "image" ? m.id : undefined}
        />
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
