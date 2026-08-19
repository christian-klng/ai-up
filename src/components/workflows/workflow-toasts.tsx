"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { CheckCircle2, Loader2, Workflow, X, XCircle } from "lucide-react";
import { useRealtimeEvent } from "@/components/realtime/realtime-provider";
import { formatDuration } from "./run-status";
import { cn } from "@/lib/utils";

type ToastItem = {
  runId: string;
  workflowId: string;
  name: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  shownAt: number;
  durationMs?: number;
  error?: string | null;
};

const MIN_VISIBLE_MS = 2000;
const LINGER_MS = 3000;

/**
 * Top-right stack of workflow run toasts: appears on run start (spinner), flips to ✓/✗ on finish,
 * stays at least 2 s, then hides after 3 s. Failed runs stay until dismissed. Multiple runs stack.
 */
export function WorkflowToasts({ isAdmin }: { isAdmin: boolean }) {
  const t = useTranslations("workflows.toasts");
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const scheduleHide = (runId: string, shownAt: number, delayAfterMin: number) => {
    const elapsed = Date.now() - shownAt;
    const wait = Math.max(0, MIN_VISIBLE_MS - elapsed) + delayAfterMin;
    clearTimeout(timers.current.get(runId));
    timers.current.set(
      runId,
      setTimeout(() => setItems((prev) => prev.filter((i) => i.runId !== runId)), wait),
    );
  };

  useRealtimeEvent("workflow.run.started", (p) => {
    setItems((prev) => (prev.some((i) => i.runId === p.runId) ? prev : [{ runId: p.runId, workflowId: p.workflowId, name: p.workflowName, status: "running" as const, shownAt: Date.now() }, ...prev].slice(0, 6)));
  });
  useRealtimeEvent("workflow.run.finished", (p) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.runId === p.runId);
      const shownAt = existing?.shownAt ?? Date.now();
      const next: ToastItem = { runId: p.runId, workflowId: p.workflowId, name: p.workflowName, status: p.status, shownAt, durationMs: p.durationMs, error: p.error };
      if (p.status !== "failed") scheduleHide(p.runId, shownAt, LINGER_MS);
      return existing ? prev.map((i) => (i.runId === p.runId ? next : i)) : [next, ...prev].slice(0, 6);
    });
  });

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((tm) => clearTimeout(tm));
  }, []);

  if (items.length === 0) return null;
  return (
    <div className="pointer-events-none fixed right-4 top-16 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
      {items.map((i) => {
        const Icon = i.status === "running" ? Loader2 : i.status === "succeeded" ? CheckCircle2 : XCircle;
        const inner = (
          <>
            <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full", i.status === "running" ? "bg-primary/10 text-primary" : i.status === "succeeded" ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-600")}>
              <Icon className={cn("size-4", i.status === "running" && "animate-spin")} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Workflow className="size-3" /> {t("workflow")}
              </span>
              <span className="block truncate text-sm font-medium">{i.name}</span>
              <span className="block text-xs text-muted-foreground">
                {i.status === "running" ? t("running") : i.status === "succeeded" ? t("succeeded", { duration: formatDuration(i.durationMs) }) : t("failed", { duration: formatDuration(i.durationMs) })}
              </span>
              {i.status === "failed" && i.error && <span className="mt-0.5 line-clamp-2 block text-xs text-red-600">{i.error}</span>}
            </span>
          </>
        );
        return (
          <div key={i.runId} className="pointer-events-auto flex items-start gap-3 rounded-lg border bg-card p-3 shadow-lg animate-in slide-in-from-right-4 fade-in">
            {isAdmin ? (
              <Link href={`/admin/workflows/${i.workflowId}/runs/${i.runId}`} className="flex min-w-0 flex-1 items-start gap-3">
                {inner}
              </Link>
            ) : (
              <Link href={`/workflows/${i.workflowId}`} className="flex min-w-0 flex-1 items-start gap-3">
                {inner}
              </Link>
            )}
            <button type="button" onClick={() => setItems((prev) => prev.filter((x) => x.runId !== i.runId))} className="rounded p-0.5 text-muted-foreground hover:bg-accent" aria-label="close">
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
