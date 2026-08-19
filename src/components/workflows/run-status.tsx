import { CheckCircle2, CircleDashed, Loader2, XCircle, Ban } from "lucide-react";
import { cn } from "@/lib/utils";

const STYLES: Record<string, { cls: string; Icon: typeof CheckCircle2; spin?: boolean }> = {
  queued: { cls: "bg-muted text-muted-foreground", Icon: CircleDashed },
  running: { cls: "bg-blue-500/10 text-blue-700 dark:text-blue-300", Icon: Loader2, spin: true },
  succeeded: { cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", Icon: CheckCircle2 },
  failed: { cls: "bg-red-500/10 text-red-700 dark:text-red-300", Icon: XCircle },
  cancelled: { cls: "bg-muted text-muted-foreground", Icon: Ban },
};

export function RunStatusBadge({ status, label, className }: { status: string; label: string; className?: string }) {
  const s = STYLES[status] ?? STYLES.queued;
  const Icon = s.Icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", s.cls, className)}>
      <Icon className={cn("size-3.5", s.spin && "animate-spin")} /> {label}
    </span>
  );
}

export function WorkflowStatusDot({ status }: { status: "draft" | "active" | "paused" }) {
  return <span className={cn("inline-block size-2 rounded-full", status === "active" ? "bg-emerald-500" : status === "paused" ? "bg-amber-500" : "bg-muted-foreground/40")} aria-hidden />;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "–";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}
