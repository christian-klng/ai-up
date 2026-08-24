import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/server/auth/session";
import { listAreas } from "@/server/domain/knowledge";
import { listStructuredAreaIds } from "@/server/domain/structures";
import { PageHeader } from "@/components/common/page-header";
import { AreaDialog } from "./area-dialog";
import { AreaList } from "./area-list";

export default async function AdminKnowledgePage() {
  await requireAdmin();
  const [t, areas, structuredIds] = await Promise.all([getTranslations("admin.knowledge"), listAreas(), listStructuredAreaIds()]);
  const structured = new Set(structuredIds);
  return (
    <div className="max-w-4xl">
      <PageHeader title={t("title")} description={t("intro")} actions={<AreaDialog mode="create" />} />
      <AreaList
        areas={areas.map((a) => ({ id: a.id, name: a.name, slug: a.slug, purpose: a.purpose, description: a.description, icon: a.icon, contentCount: a.contentCount, hasStructure: structured.has(a.id) }))}
      />
    </div>
  );
}
