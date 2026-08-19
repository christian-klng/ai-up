import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { getWorkflow, listRuns } from "@/server/workflows/service";
import { getEditorCatalog } from "@/server/workflows/catalog";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { RunStatusBadge, formatDuration } from "@/components/workflows/run-status";
import { WorkflowDefinitionView } from "@/components/workflows/definition-view";

export default async function WorkflowDetailPage({ params }: PageProps<"/workflows/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const wf = await getWorkflow(id);
  if (!wf || (wf.status === "draft" && user.role !== "admin")) notFound();
  const [t, format, locale, runs, catalog] = await Promise.all([getTranslations("workflows"), getFormatter(), getLocale(), listRuns({ workflowId: wf.id, limit: 10 }), getEditorCatalog()]);
  const loc = locale === "en" ? "en" : "de";
  return (
    <div className="max-w-3xl">
      <Link href="/workflows" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {t("title")}
      </Link>
      <PageHeader title={wf.name} description={wf.description ?? undefined} actions={<Badge variant="secondary">{t(`status.${wf.status}`)}</Badge>} />
      {user.role === "admin" && (
        <p className="mb-4 text-sm">
          <Link href={`/admin/workflows/${wf.id}`} className="text-primary hover:underline">
            {t("openInAdmin")}
          </Link>
        </p>
      )}
      <WorkflowDefinitionView definition={{ name: wf.name, description: wf.description, trigger: wf.trigger, steps: wf.steps }} catalog={catalog} locale={loc} showConfig />
      <section className="mt-6">
        <h2 className="mb-2 text-base font-semibold">{t("recentRuns")}</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noRuns")}</p>
        ) : (
          <ul className="divide-y rounded-lg border bg-card">
            {runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm">
                <RunStatusBadge status={r.status} label={t(`runStatus.${r.status}`)} />
                <span>{format.dateTime(r.createdAt, { dateStyle: "medium", timeStyle: "short" })}</span>
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">{formatDuration(r.durationMs)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
