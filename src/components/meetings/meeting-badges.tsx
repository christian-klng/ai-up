import { CalendarClock, FileText, Mic, Video } from "lucide-react";
import { cn } from "@/lib/utils";

export const KIND_ICONS = { protocol: FileText, audio: Mic, video: Video } as const;

export function MeetingKindIcon({ kind, className }: { kind: "protocol" | "audio" | "video"; className?: string }) {
  const Icon = KIND_ICONS[kind] ?? CalendarClock;
  return <Icon className={cn("size-4", className)} aria-hidden />;
}

/** Green blinking dot for live meetings (same look as in the sidebar). */
export function LiveDot({ className }: { className?: string }) {
  return <span className={cn("inline-block size-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_0_3px_rgba(16,185,129,0.25)]", className)} aria-hidden />;
}

export function MeetingStatusBadge({ status, label }: { status: "scheduled" | "live" | "ended"; label: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium", status === "live" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : status === "scheduled" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
      {status === "live" && <LiveDot />}
      {label}
    </span>
  );
}
