import Link from "next/link";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { requireAdmin } from "@/server/auth/session";
import { listWorkflows, workflowStats } from "@/server/workflows/service";
import { loadRegistry } from "@/server/workflows/registry";
import { describeTrigger } from "@/server/workflows/definitions";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { RunStatusBadge, WorkflowStatusDot } from "@/components/workflows/run-status";
import { StatsPanel } from "./stats-panel";
import { WorkflowRowActions } from "./row-actions";

export default async function AdminWorkflowsPage() {
  await requireAdmin();
  await loadRegistry();
  const [t, tw, format, locale, items, stats] = await Promise.all([getTranslations("admin.workflows"), getTranslations("workflows"), getFormatter(), getLocale(), listWorkflows(), workflowStats(null, 14)]);
  const loc = locale === "en" ? "en" : "de";

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={t("title")}
        description={t("intro")}
        actions={
          <Button asChild>
            <Link href="/admin/workflows/new">
              <Plus className="size-4" /> {t("create")}
            </Link>
          </Button>
        }
      />
      <StatsPanel stats={{ ...stats, lastRunAt: stats.lastRunAt?.toISOString() ?? null }} />

      {items.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{t("empty")}</div>
      ) : (
        <ul className="mt-6 divide-y rounded-lg border bg-card">
          {items.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <WorkflowStatusDot status={w.status} />
              <div className="min-w-0 flex-1">
                <Link href={`/admin/workflows/${w.id}`} className="font-medium hover:underline">
                  {w.name}
                </Link>
                <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <span>{tw(`status.${w.status}`)}</span>
                  <span>·</span>
                  <span>{describeTrigger(w.trigger, loc)}</span>
                  <span>·</span>
                  <span>{tw("stepCount", { count: w.steps.length })}</span>
                  <span>·</span>
                  <span>{tw("runCount", { count: w.runCount })}</span>
                  {w.runCount > 0 && <span>· {tw("successRate", { rate: Math.round((w.successCount / w.runCount) * 100) })}</span>}
                  {w.lastRunAt && <span>· {tw("lastRun", { date: format.relativeTime(w.lastRunAt) })}</span>}
                </div>
              </div>
              {w.lastRunStatus && <RunStatusBadge status={w.lastRunStatus} label={tw(`runStatus.${w.lastRunStatus}`)} />}
              <WorkflowRowActions id={w.id} status={w.status} name={w.name} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
