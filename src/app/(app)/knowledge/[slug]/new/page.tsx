import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { getAreaBySlug } from "@/server/domain/knowledge";
import { env } from "@/server/env";
import { PageHeader } from "@/components/common/page-header";
import { ContentEditor } from "@/components/content/content-editor";

export default async function NewContentPage({ params }: PageProps<"/knowledge/[slug]/new">) {
  await requireUser();
  const { slug } = await params;
  const area = await getAreaBySlug(slug);
  if (!area) notFound();
  const t = await getTranslations("knowledge.editor");
  return (
    <div className="mx-auto max-w-3xl">
      <Link href={`/knowledge/${area.slug}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {area.name}
      </Link>
      <PageHeader title={t("createTitle")} />
      <ContentEditor areaId={area.id} areaSlug={area.slug} maxUploadMb={env.MAX_UPLOAD_MB} />
    </div>
  );
}
