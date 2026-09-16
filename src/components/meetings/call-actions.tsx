"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Circle, Disc, LogIn, Play, RotateCcw, Square } from "lucide-react";
import { endMeetingAction, reopenMeetingAction, startRecordingAction, stopRecordingAction } from "@/server/actions/meetings";
import { Button } from "@/components/ui/button";

/**
 * Call buttons of the details card (right column of the meeting page): join/start, end or reopen
 * for hosts, plus the recording state with start/stop. Participants live in their own card.
 */
export function CallActions({ meetingId, callHref, status, kind, canHost, callsAvailable, recording }: { meetingId: string; callHref: string; status: "scheduled" | "live" | "ended"; kind: "audio" | "video"; canHost: boolean; callsAvailable: boolean; recording: { enabled: boolean; status: "none" | "recording" | "processing" | "available" | "failed"; error: string | null } }) {
  const t = useTranslations("meetings.call");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();

  const recordingChip =
    recording.status === "recording" ? (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-600">
        <Circle className="size-2 animate-pulse fill-current" /> {t("rec.recording")}
      </span>
    ) : recording.status === "processing" ? (
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{t("rec.processing")}</span>
    ) : recording.status === "available" ? (
      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-300">{t("rec.available")}</span>
    ) : recording.status === "failed" ? (
      <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-600" title={recording.error ?? undefined}>
        {t("rec.failed")}
      </span>
    ) : null;

  const canToggleRecording = status === "live" && canHost && callsAvailable;
  const recordingButton =
    canToggleRecording && recording.status === "recording" ? (
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => start(async () => { await stopRecordingAction(meetingId); router.refresh(); })}>
        <Square className="size-4" /> {t("rec.stop")}
      </Button>
    ) : canToggleRecording && recording.status !== "processing" ? (
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => start(async () => { const r = await startRecordingAction(meetingId); if (!r.ok) toast.error(r.error ?? tc("unexpectedError")); router.refresh(); })}>
        <Disc className="size-4" /> {t("rec.start")}
      </Button>
    ) : null;

  const hint = !callsAvailable ? t("unavailable") : status === "scheduled" ? (recording.enabled ? t("rec.autoHint") : t("notStartedHint")) : status === "ended" ? t("endedHint") : null;

  return (
    <div className="grid gap-2">
      {status !== "ended" && callsAvailable && (
        <Button asChild size="lg" className="w-full">
          <Link href={callHref}>
            {status === "live" ? <LogIn className="size-4" /> : <Play className="size-4" />} {status === "live" ? t("join") : kind === "audio" ? t("startAudio") : t("startVideo")}
          </Link>
        </Button>
      )}
      {status === "live" && canHost && (
        <Button variant="outline" className="w-full" disabled={pending} onClick={() => { if (!confirm(t("confirmEnd"))) return; start(async () => { const r = await endMeetingAction(meetingId); if (r.ok) toast.success(t("ended")); else toast.error(tc("unexpectedError")); router.refresh(); }); }}>
          <Square className="size-4" /> {t("end")}
        </Button>
      )}
      {status === "ended" && canHost && (
        <Button variant="outline" className="w-full" disabled={pending} onClick={() => start(async () => { await reopenMeetingAction(meetingId); router.refresh(); })}>
          <RotateCcw className="size-4" /> {t("reopen")}
        </Button>
      )}
      {(recordingChip || recordingButton) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {recordingChip ?? <span />}
          {recordingButton}
        </div>
      )}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
