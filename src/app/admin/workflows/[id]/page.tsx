import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft, Pencil } from "lucide-react";
import { requireAdmin } from "@/server/auth/session";
import { loadRegistry } from "@/server/workflows/registry";
import { getWorkflow, listRuns, listWorkflowVersions, workflowStats } from "@/server/workflows/service";
import { nextScheduledRun } from "@/server/workflows/queue";
import { getEditorCatalog } from "@/server/workflows/catalog";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RunStatusBadge, WorkflowStatusDot, formatDuration } from "@/components/workflows/run-status";
import { WorkflowDefinitionView } from "@/components/workflows/definition-view";
import { StatsPanel } from "../stats-panel";
import { WorkflowRowActions } from "../row-actions";
import { RunNowPanel } from "./run-now-panel";

export default async function AdminWorkflowDetailPage({ params }: PageProps<"/admin/workflows/[id]">) {
  await requireAdmin();
  await loadRegistry();
  const { id } = await params;
  const wf = await getWorkflow(id);
  if (!wf) notFound();
  const [t, tw, format, locale, runs, versions, stats, catalog, nextRun] = await Promise.all([
    getTranslations("admin.workflows"),
    getTranslations("workflows"),
    getFormatter(),
    getLocale(),
    listRuns({ workflowId: wf.id, limit: 30 }),
    listWorkflowVersions(wf.id),
    workflowStats(wf.id, 14),
    getEditorCatalog(),
    wf.trigger.type === "schedule" && wf.status === "active" ? nextScheduledRun(wf.id).catch(() => null) : Promise.resolve(null),
  ]);
  const loc = locale === "en" ? "en" : "de";
  const trigger = catalog.triggers.find((x) => x.type === wf.trigger.type);

  return (
    <div className="max-w-5xl">
      <Link href="/admin/workflows" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {t("title")}
      </Link>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <WorkflowStatusDot status={wf.status} /> {wf.name}
          </span>
        }
        description={wf.description ?? undefined}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/admin/workflows/${wf.id}/edit`}>
                <Pencil className="size-4" /> {t("edit")}
              </Link>
            </Button>
            <WorkflowRowActions id={wf.id} status={wf.status} name={wf.name} />
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Badge variant="secondary">{tw(`status.${wf.status}`)}</Badge>
        <span>{tw("version", { no: wf.version })}</span>
        <span>·</span>
        <span>{tw("updatedAt", { date: format.dateTime(wf.updatedAt, { dateStyle: "medium", timeStyle: "short" }) })}</span>
        {nextRun && (
          <>
            <span>·</span>
            <span>{tw("nextRun", { date: format.dateTime(nextRun, { dateStyle: "medium", timeStyle: "short" }) })}</span>
          </>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="grid gap-6">
          <StatsPanel stats={{ ...stats, lastRunAt: stats.lastRunAt?.toISOString() ?? null }} compact />
          <section>
            <h2 className="mb-2 text-base font-semibold">{tw("definition")}</h2>
            <WorkflowDefinitionView definition={{ name: wf.name, description: wf.description, trigger: wf.trigger, steps: wf.steps }} catalog={catalog} locale={loc} showConfig />
          </section>
          <section>
            <h2 className="mb-2 text-base font-semibold">{tw("runs")}</h2>
            {runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">{tw("noRuns")}</p>
            ) : (
              <ul className="divide-y rounded-lg border bg-card">
                {runs.map((r) => (
                  <li key={r.id}>
                    <Link href={`/admin/workflows/${wf.id}/runs/${r.id}`} className="flex flex-wrap items-center gap-3 px-4 py-2.5 hover:bg-accent/40">
                      <RunStatusBadge status={r.status} label={tw(`runStatus.${r.status}`)} />
                      <span className="text-sm">{format.dateTime(r.createdAt, { dateStyle: "medium", timeStyle: "medium" })}</span>
                      <span className="text-xs text-muted-foreground">{r.triggerType}</span>
                      <span className="ml-auto text-xs tabular-nums text-muted-foreground">{formatDuration(r.durationMs)}</span>
                      {r.error && <span className="w-full truncate text-xs text-destructive">{r.error}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <div className="grid gap-6 self-start">
          <RunNowPanel workflowId={wf.id} triggerType={wf.trigger.type} samplePayload={trigger?.samplePayload ?? {}} toastAudience={wf.toastAudience as "all" | "admins"} />
          <section className="rounded-lg border bg-card p-4">
            <h2 className="mb-2 text-sm font-semibold">{tw("versions")}</h2>
            <ul className="grid gap-1 text-sm">
              {versions.map((v) => (
                <li key={v.id} className="flex items-baseline gap-2">
                  <span className="font-medium">v{v.version}</span>
                  <span className="text-xs text-muted-foreground">
                    {format.dateTime(v.createdAt, { dateStyle: "medium", timeStyle: "short" })} · {v.source}
                  </span>
                  {v.changeNote && <span className="truncate text-xs italic text-muted-foreground">{v.changeNote}</span>}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
