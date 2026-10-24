"use client";

import "@livekit/components-styles";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AudioConference, RoomContext } from "@livekit/components-react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useCall } from "./call-provider";
import { CaptureBadge, CaptureMarker } from "./capture-badge";
import { VideoConference } from "./video-conference";

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
 *
 * No header row: the way back is the sidebar or the leave button, so the call gets the full height. The
 * negative margin cancels the shell's vertical padding – otherwise the page is taller than the viewport
 * and the control bar slides below the fold. The capture marker sits on the call area instead.
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
    <div className="relative -my-6 h-[calc(100svh-3.5rem)] bg-black/95" data-lk-theme="default">
      <div className="pointer-events-none absolute left-3 top-3 z-10 [&>*]:pointer-events-auto">
        {connectedHere ? (
          <RoomContext.Provider value={room}>
            <CaptureBadge recordingEnabled={recordingEnabled} />
          </RoomContext.Provider>
        ) : (
          recordingEnabled && <CaptureMarker label={t("recordingBadge")} />
        )}
      </div>
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
        <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-white/60">
          <Loader2 className="size-6 animate-spin" />
          {t("connecting")}
        </div>
      )}
    </div>
  );
}
