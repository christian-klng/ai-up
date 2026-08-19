import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/server/auth/session";
import { getEditorCatalog } from "@/server/workflows/catalog";
import { PageHeader } from "@/components/common/page-header";
import { WorkflowEditor } from "@/components/workflows/workflow-editor";

export default async function NewWorkflowPage() {
  await requireAdmin();
  const [t, catalog] = await Promise.all([getTranslations("admin.workflows"), getEditorCatalog()]);
  return (
    <div className="max-w-4xl">
      <Link href="/admin/workflows" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {t("title")}
      </Link>
      <PageHeader title={t("create")} description={t("createIntro")} />
      <WorkflowEditor catalog={catalog} />
    </div>
  );
}
