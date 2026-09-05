import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/server/auth/session";
import { listProviderOptions } from "@/server/llm/providers";
import { PageHeader } from "@/components/common/page-header";
import { StructureEditor } from "@/components/structures/structure-editor";

export default async function NewTemplatePage() {
  await requireAdmin();
  const [t, providers] = await Promise.all([getTranslations("admin.templates"), listProviderOptions()]);
  return (
    <div>
      <Link href="/admin/templates" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {t("listTitle")}
      </Link>
      <PageHeader title={t("create")} description={t("intro")} />
      <StructureEditor templateId={null} initial={null} initialVersion={null} isSystem={false} providers={providers} />
    </div>
  );
}
