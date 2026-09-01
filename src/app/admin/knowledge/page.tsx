import { getTranslations } from "next-intl/server";
import { requireAdmin } from "@/server/auth/session";
import { listAreas } from "@/server/domain/knowledge";
import { listAllAssignments, listTemplates } from "@/server/domain/templates";
import { PageHeader } from "@/components/common/page-header";
import { AreaDialog } from "./area-dialog";
import { AreaList } from "./area-list";

export default async function AdminKnowledgePage() {
  await requireAdmin();
  const [t, areas, assignments, templates] = await Promise.all([getTranslations("admin.knowledge"), listAreas(), listAllAssignments(), listTemplates()]);
  return (
    <div className="max-w-4xl">
      <PageHeader title={t("title")} description={t("intro")} actions={<AreaDialog mode="create" />} />
      <AreaList
        areas={areas.map((a) => ({
          id: a.id,
          name: a.name,
          slug: a.slug,
          purpose: a.purpose,
          description: a.description,
          icon: a.icon,
          layout: a.layout,
          contentCount: a.contentCount,
          assignedTemplateIds: (assignments.get(a.id) ?? []).map((tpl) => tpl.id),
        }))}
        templates={templates.map((tpl) => ({ id: tpl.id, name: tpl.name, icon: tpl.icon, isSystem: tpl.isSystem }))}
      />
    </div>
  );
}
