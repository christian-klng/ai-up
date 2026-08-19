"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { useRealtimeEvent } from "@/components/realtime/realtime-provider";
import { retryRunAction } from "@/server/actions/admin-workflows";
import { Button } from "@/components/ui/button";
import { RunStatusBadge, formatDuration } from "@/components/workflows/run-status";
import { cn } from "@/lib/utils";

type StepView = { id: string; index: number; stepId: string; stepName: string | null; actionType: string; status: string; skipped: boolean; input: Record<string, unknown>; output: Record<string, unknown>; error: string | null; usage: Record<string, unknown>; durationMs: number | null };
type RunView = { id: string; workflowId: string; status: string; error: string | null; triggerEvent: Record<string, unknown>; context: Record<string, unknown>; durationMs: number | null; steps: StepView[] };

function Json({ value, max = 4000 }: { value: unknown; max?: number }) {
  const [full, setFull] = useState(false);
  const s = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const shown = full || s.length <= max ? s : `${s.slice(0, max)}…`;
  return (
    <div>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3 text-xs">{shown}</pre>
      {s.length > max && !full && (
        <button type="button" onClick={() => setFull(true)} className="mt-1 text-xs text-primary hover:underline">
          … ({s.length})
        </button>
      )}
    </div>
  );
}

/** Long text fields (prompt, markdown, model answers) are shown as readable text blocks, the rest as JSON. */
function KeyValues({ obj }: { obj: Record<string, unknown> }) {
  const entries = Object.entries(obj);
  if (!entries.length) return <span className="text-xs text-muted-foreground">–</span>;
  return (
    <div className="grid gap-2">
      {entries.map(([k, v]) => (
        <div key={k} className="grid gap-1">
          <div className="font-mono text-[11px] text-muted-foreground">{k}</div>
          {typeof v === "string" && v.length > 120 ? <Json value={v} /> : typeof v === "object" && v !== null ? <Json value={v} /> : <div className="font-mono text-xs">{String(v)}</div>}
        </div>
      ))}
    </div>
  );
}

export function RunDetail({ run }: { run: RunView }) {
  const t = useTranslations("admin.workflows");
  const tw = useTranslations("workflows");
  const router = useRouter();
  const [pending, start] = useTransition();
  useRealtimeEvent("workflow.run.finished", (p) => {
    if (p.runId === run.id) router.refresh();
  });
  useRealtimeEvent("workflow.run.started", (p) => {
    if (p.runId === run.id) router.refresh();
  });

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-2">
        {(run.status === "succeeded" || run.status === "failed") && (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await retryRunAction(run.id);
                if (res.ok) {
                  toast.success(t("runStarted"));
                  router.push(`/admin/workflows/${run.workflowId}/runs/${res.runId}`);
                } else toast.error(res.error);
              })
            }
          >
            <RotateCcw className="size-4" /> {t("retry")}
          </Button>
        )}
        {(run.status === "queued" || run.status === "running") && <span className="text-sm text-muted-foreground">{t("liveHint")}</span>}
      </div>

      <section className="grid gap-2">
        <h2 className="text-sm font-semibold">{t("triggerEvent")}</h2>
        <Json value={run.triggerEvent} />
      </section>

      <section className="grid gap-3">
        <h2 className="text-sm font-semibold">{tw("steps")}</h2>
        <ol className="grid gap-3">
          {run.steps.map((s) => (
            <li key={s.id} className={cn("rounded-lg border bg-card p-4", s.status === "failed" && "border-destructive/50")}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{s.index + 1}</span>
                <span className="font-medium">{s.stepName || s.stepId}</span>
                <span className="font-mono text-xs text-muted-foreground">{s.actionType}</span>
                <RunStatusBadge status={s.skipped ? "cancelled" : s.status} label={s.skipped ? t("skipped") : tw(`runStatus.${s.status}`)} />
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">{formatDuration(s.durationMs)}</span>
                {typeof s.usage.totalTokens === "number" && (
                  <span className="text-xs text-muted-foreground">
                    · {s.usage.totalTokens} tokens{typeof s.usage.cost === "number" && s.usage.cost > 0 ? ` · $${s.usage.cost.toFixed(4)}` : ""}
                  </span>
                )}
              </div>
              {s.error && <p className="mt-2 rounded-md bg-destructive/5 p-2 text-sm text-destructive">{s.error}</p>}
              {!s.skipped && (
                <div className="mt-3 grid gap-4 lg:grid-cols-2">
                  <div>
                    <div className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">{t("input")}</div>
                    <KeyValues obj={s.input} />
                  </div>
                  <div>
                    <div className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">{t("output")}</div>
                    <KeyValues obj={s.output} />
                  </div>
                </div>
              )}
            </li>
          ))}
          {run.steps.length === 0 && <li className="text-sm text-muted-foreground">{t("noStepsYet")}</li>}
        </ol>
      </section>
    </div>
  );
}
