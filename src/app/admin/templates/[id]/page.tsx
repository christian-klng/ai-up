import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/server/auth/session";
import { getTemplateById } from "@/server/domain/templates";
import { listProviderOptions } from "@/server/llm/providers";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { StructureEditor } from "@/components/structures/structure-editor";

export default async function EditTemplatePage({ params }: PageProps<"/admin/templates/[id]">) {
  await requireAdmin();
  const { id } = await params;
  const [t, template, providers] = await Promise.all([getTranslations("admin.templates"), getTemplateById(id), listProviderOptions()]);
  if (!template) notFound();
  return (
    <div>
      <Link href="/admin/templates" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {t("listTitle")}
      </Link>
      <PageHeader
        title={template.name}
        description={t("intro")}
        actions={
          <span className="flex items-center gap-2">
            {template.isSystem && <Badge variant="secondary">{t("systemBadge")}</Badge>}
            <Badge variant="outline">v{template.version}</Badge>
          </span>
        }
      />
      <StructureEditor
        templateId={template.id}
        initial={{ name: template.name, description: template.description, icon: template.icon, definition: template.definition, evaluation: template.evaluation }}
        initialVersion={template.version}
        isSystem={template.isSystem}
        providers={providers}
      />
    </div>
  );
}
