import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/server/auth/session";
import { getAreaById } from "@/server/domain/knowledge";
import { getStructureByAreaId } from "@/server/domain/structures";
import { PageHeader } from "@/components/common/page-header";
import { StructureEditor } from "@/components/structures/structure-editor";

export default async function StructurePage({ params }: PageProps<"/admin/knowledge/[id]/structure">) {
  await requireAdmin();
  const { id } = await params;
  const [t, area] = await Promise.all([getTranslations("admin.knowledge.structure"), getAreaById(id)]);
  if (!area) notFound();
  const structure = await getStructureByAreaId(area.id);
  return (
    <div className="max-w-6xl">
      <Link href="/admin/knowledge" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {area.name}
      </Link>
      <PageHeader title={t("title")} description={t("intro")} />
      <StructureEditor areaId={area.id} initial={structure?.definition ?? null} initialVersion={structure?.version ?? null} />
    </div>
  );
}
