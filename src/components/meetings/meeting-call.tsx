"use client";

import "@livekit/components-styles";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AudioConference, RoomContext, VideoConference } from "@livekit/components-react";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { MeetingKindIcon } from "./meeting-badges";
import { useCall } from "./call-provider";

type Props = {
  meetingId: string;
  spaceSlug: string;
  title: string;
  kind: "audio" | "video";
  backHref: string;
  recordingEnabled: boolean;
};

/**
 * Full-page call UI rendering against the shared room owned by CallProvider – navigating away keeps
 * the call alive (mini player takes over). Video meetings get the full VideoConference layout
 * (tiles, screen share, chat); audio meetings a compact AudioConference.
 */
export function MeetingCall({ meetingId, spaceSlug, title, kind, backHref, recordingEnabled }: Props) {
  const t = useTranslations("meetings.call");
  const router = useRouter();
  const { activeCall, status, room, join } = useCall();
  const startedRef = useRef(false);
  const joinedRef = useRef(false);

  // Join once on mount; idempotent when already in this meeting's call (returning from the mini player).
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    if (activeCall && activeCall.meetingId !== meetingId && !confirm(t("mini.switchConfirm"))) {
      router.push(backHref);
      return;
    }
    void join({ meetingId, spaceSlug, title, kind }).then((res) => {
      if (res.ok) return;
      toast.error(res.error === "notConfigured" ? t("unavailable") : res.error === "ended" ? t("endedHint") : t("mini.joinFailed"));
      router.push(backHref);
    });
  }, [activeCall, backHref, join, kind, meetingId, router, spaceSlug, t, title]);

  // After having been connected here, an idle transition means the call ended (leave button or remote end).
  useEffect(() => {
    if (activeCall?.meetingId === meetingId && status === "connected") joinedRef.current = true;
    if (joinedRef.current && status === "idle") {
      router.push(backHref);
      router.refresh();
    }
  }, [activeCall, backHref, meetingId, router, status]);

  const connectedHere = room !== null && activeCall?.meetingId === meetingId;

  return (
    <div className="flex h-[calc(100svh-3.5rem)] flex-col" data-lk-theme="default">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b bg-background px-3">
        <Button asChild variant="ghost" size="sm">
          <Link href={backHref}>
            <ArrowLeft className="size-4" /> {t("back")}
          </Link>
        </Button>
        <MeetingKindIcon kind={kind} className="text-muted-foreground" />
        <span className="truncate text-sm font-medium">{title}</span>
        {recordingEnabled && <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-600"><span className="size-1.5 rounded-full bg-red-500 animate-pulse" />{t("recordingBadge")}</span>}
        {!connectedHere && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> {t("connecting")}
          </span>
        )}
      </header>
      <div className="min-h-0 flex-1 bg-black/95">
        {connectedHere ? (
          <RoomContext.Provider value={room}>
            {kind === "video" ? (
              <VideoConference />
            ) : (
              <div className="mx-auto flex h-full max-w-3xl flex-col justify-center p-4">
                <AudioConference />
              </div>
            )}
          </RoomContext.Provider>
        ) : (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-6 animate-spin text-white/50" />
          </div>
        )}
      </div>
    </div>
  );
}
