import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/server/auth/session";
import { getRunWithSteps, getWorkflow } from "@/server/workflows/service";
import { PageHeader } from "@/components/common/page-header";
import { RunStatusBadge, formatDuration } from "@/components/workflows/run-status";
import { RunDetail } from "./run-detail";

export default async function RunDetailPage({ params }: PageProps<"/admin/workflows/[id]/runs/[runId]">) {
  await requireAdmin();
  const { id, runId } = await params;
  const [wf, run, t, tw, format] = await Promise.all([getWorkflow(id), getRunWithSteps(runId), getTranslations("admin.workflows"), getTranslations("workflows"), getFormatter()]);
  if (!wf || !run || run.workflowId !== wf.id) notFound();

  return (
    <div className="max-w-5xl">
      <Link href={`/admin/workflows/${wf.id}`} className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> {wf.name}
      </Link>
      <PageHeader
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            {t("runTitle", { date: format.dateTime(run.createdAt, { dateStyle: "medium", timeStyle: "medium" }) })}
            <RunStatusBadge status={run.status} label={tw(`runStatus.${run.status}`)} />
          </span>
        }
        description={`${run.triggerType} · v${run.workflowVersion} · ${formatDuration(run.durationMs)}${run.error ? ` · ${run.error}` : ""}`}
      />
      <RunDetail
        run={{
          id: run.id,
          workflowId: run.workflowId,
          status: run.status,
          error: run.error,
          triggerEvent: run.triggerEvent,
          context: run.context,
          durationMs: run.durationMs,
          steps: run.steps.map((s) => ({
            id: s.id,
            index: s.index,
            stepId: s.stepId,
            stepName: s.stepName,
            actionType: s.actionType,
            status: s.status,
            skipped: s.skipped,
            input: s.input,
            output: s.output,
            error: s.error,
            usage: s.usage,
            durationMs: s.durationMs,
          })),
        }}
      />
    </div>
  );
}
