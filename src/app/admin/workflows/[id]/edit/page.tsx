import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/server/auth/session";
import { getEditorCatalog } from "@/server/workflows/catalog";
import { getWorkflow, toDefinition } from "@/server/workflows/service";
import { PageHeader } from "@/components/common/page-header";
import { WorkflowEditor } from "@/components/workflows/workflow-editor";

export default async function EditWorkflowPage({ params }: PageProps<"/admin/workflows/[id]/edit">) {
  await requireAdmin();
  const { id } = await params;
  const [t, catalog, wf] = await Promise.all([getTranslations("admin.workflows"), getEditorCatalog(), getWorkflow(id)]);
  if (!wf) notFound();
  return (
    <div className="max-w-4xl">
      <Link href={`/admin/workflows/${wf.id}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {wf.name}
      </Link>
      <PageHeader title={t("edit")} description={t("editIntro", { version: wf.version })} />
      <WorkflowEditor catalog={catalog} initial={toDefinition(wf)} workflowId={wf.id} />
    </div>
  );
}
