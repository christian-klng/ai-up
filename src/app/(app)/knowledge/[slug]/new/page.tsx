import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { getAreaBySlug } from "@/server/domain/knowledge";
import { listAvailableTemplates } from "@/server/domain/templates";
import { env } from "@/server/env";
import { PageHeader } from "@/components/common/page-header";
import { StructureFillForm } from "@/components/structures/structure-fill-form";
import { TemplateIcon } from "@/components/structures/template-icon";

export default async function NewContentPage({ params, searchParams }: PageProps<"/knowledge/[slug]/new">) {
  await requireUser();
  const [{ slug }, sp] = await Promise.all([params, searchParams]);
  const area = await getAreaBySlug(slug);
  if (!area) notFound();
  const templates = await listAvailableTemplates(area.id);
  if (templates.length === 0) notFound();

  const requested = typeof sp.template === "string" ? templates.find((t) => t.id === sp.template) : undefined;
  const selected = requested ?? (templates.length === 1 ? templates[0] : undefined);
  const t = await getTranslations(selected ? "knowledge.structured" : "knowledge.picker");

  return (
    <div className="mx-auto max-w-3xl">
      <Link href={`/knowledge/${area.slug}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {area.name}
      </Link>
      {selected ? (
        <>
          <PageHeader title={selected.name} description={selected.description ?? undefined} />
          <StructureFillForm def={selected.definition} mode="create" areaId={area.id} areaSlug={area.slug} templateId={selected.id} maxUploadMb={env.MAX_UPLOAD_MB} />
        </>
      ) : (
        <>
          <PageHeader title={t("title")} description={t("intro")} />
          <div className="grid gap-2 sm:grid-cols-2">
            {templates.map((tpl) => (
              <Link
                key={tpl.id}
                href={`/knowledge/${area.slug}/new?template=${tpl.id}`}
                className="flex items-start gap-3 rounded-lg border p-4 text-left transition-colors hover:border-primary hover:bg-accent/60"
              >
                <TemplateIcon icon={tpl.icon} className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                <span>
                  <span className="block text-sm font-medium">{tpl.name}</span>
                  {tpl.description && <span className="block text-xs text-muted-foreground">{tpl.description}</span>}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
