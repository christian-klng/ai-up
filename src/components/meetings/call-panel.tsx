"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Circle, Disc, LogIn, Play, RotateCcw, Square } from "lucide-react";
import { endMeetingAction, reopenMeetingAction, startRecordingAction, stopRecordingAction } from "@/server/actions/meetings";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/shell/user-avatar";
import { LiveDot } from "./meeting-badges";

type Participant = { id: string; identity: string; displayName: string | null; user: { id: string; name: string; avatarMediaId: string | null } | null };

export function CallPanel({ meetingId, callHref, status, kind, canHost, callsAvailable, participants, participantCount, recording }: { meetingId: string; callHref: string; status: "scheduled" | "live" | "ended"; kind: "audio" | "video"; canHost: boolean; callsAvailable: boolean; participants: Participant[]; participantCount: number; recording: { enabled: boolean; status: "none" | "recording" | "processing" | "available" | "failed"; error: string | null } }) {
  const t = useTranslations("meetings.call");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <section className="rounded-lg border bg-card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-base font-semibold">{t("title")}</h2>
        {status === "live" && (
          <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300">
            <LiveDot /> {t("liveWith", { count: participantCount })}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {status !== "ended" && callsAvailable && (
            <Button asChild>
              <Link href={callHref}>
                {status === "live" ? <LogIn className="size-4" /> : <Play className="size-4" />} {status === "live" ? t("join") : kind === "audio" ? t("startAudio") : t("startVideo")}
              </Link>
            </Button>
          )}
          {status === "live" && canHost && (
            <Button variant="outline" disabled={pending} onClick={() => { if (!confirm(t("confirmEnd"))) return; start(async () => { const r = await endMeetingAction(meetingId); if (r.ok) toast.success(t("ended")); else toast.error(tc("unexpectedError")); router.refresh(); }); }}>
              <Square className="size-4" /> {t("end")}
            </Button>
          )}
          {status === "ended" && canHost && (
            <Button variant="outline" disabled={pending} onClick={() => start(async () => { await reopenMeetingAction(meetingId); router.refresh(); })}>
              <RotateCcw className="size-4" /> {t("reopen")}
            </Button>
          )}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        {recording.status === "recording" && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-600">
            <Circle className="size-2 fill-current animate-pulse" /> {t("rec.recording")}
          </span>
        )}
        {recording.status === "processing" && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{t("rec.processing")}</span>}
        {recording.status === "available" && <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-300">{t("rec.available")}</span>}
        {recording.status === "failed" && <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-600" title={recording.error ?? undefined}>{t("rec.failed")}</span>}
        {status === "live" && canHost && callsAvailable && recording.status !== "recording" && recording.status !== "processing" && (
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => start(async () => { const r = await startRecordingAction(meetingId); if (!r.ok) toast.error(r.error ?? tc("unexpectedError")); router.refresh(); })}>
            <Disc className="size-4" /> {t("rec.start")}
          </Button>
        )}
        {status === "live" && canHost && recording.status === "recording" && (
          <Button variant="ghost" size="sm" disabled={pending} onClick={() => start(async () => { await stopRecordingAction(meetingId); router.refresh(); })}>
            <Square className="size-4" /> {t("rec.stop")}
          </Button>
        )}
        {status === "scheduled" && recording.enabled && <span className="text-xs text-muted-foreground">{t("rec.autoHint")}</span>}
      </div>
      {!callsAvailable && <p className="mt-2 text-sm text-muted-foreground">{t("unavailable")}</p>}
      {status === "scheduled" && callsAvailable && <p className="mt-2 text-sm text-muted-foreground">{t("notStartedHint")}</p>}
      {status === "ended" && <p className="mt-2 text-sm text-muted-foreground">{t("endedHint")}</p>}
      {participants.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">{status === "live" ? t("inCall") : t("wasInCall")}</div>
          <ul className="flex flex-wrap gap-2">
            {participants.map((p) => (
              <li key={p.id} className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs">
                {p.user && <UserAvatar user={p.user} size={16} variant="thumb" />}
                {p.user?.name ?? p.displayName ?? p.identity}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
