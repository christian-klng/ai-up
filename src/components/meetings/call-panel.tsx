"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { LogIn, Play, RotateCcw, Square } from "lucide-react";
import { endMeetingAction, reopenMeetingAction } from "@/server/actions/meetings";
import { Button } from "@/components/ui/button";
import { UserAvatar } from "@/components/shell/user-avatar";
import { LiveDot } from "./meeting-badges";

type Participant = { id: string; identity: string; displayName: string | null; user: { id: string; name: string; avatarMediaId: string | null } | null };

export function CallPanel({ meetingId, callHref, status, kind, canHost, callsAvailable, participants, participantCount }: { meetingId: string; callHref: string; status: "scheduled" | "live" | "ended"; kind: "audio" | "video"; canHost: boolean; callsAvailable: boolean; participants: Participant[]; participantCount: number }) {
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
