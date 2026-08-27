import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { requireAdmin } from "@/server/auth/session";
import { listTemplates } from "@/server/domain/templates";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { TemplateList } from "./template-list";

export default async function AdminTemplatesPage() {
  await requireAdmin();
  const [t, templates] = await Promise.all([getTranslations("admin.templates"), listTemplates()]);
  return (
    <div className="max-w-4xl">
      <PageHeader
        title={t("listTitle")}
        description={t("listIntro")}
        actions={
          <Button asChild>
            <Link href="/admin/templates/new">
              <Plus className="size-4" /> {t("create")}
            </Link>
          </Button>
        }
      />
      <TemplateList
        templates={templates.map((tpl) => ({
          id: tpl.id,
          name: tpl.name,
          description: tpl.description,
          icon: tpl.icon,
          version: tpl.version,
          isSystem: tpl.isSystem,
          assignmentCount: tpl.assignmentCount,
        }))}
      />
    </div>
  );
}
