"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { ConnectionState, Track } from "livekit-client";
import {
  RoomContext,
  VideoTrack,
  useConnectionState,
  useIsRecording,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useStartAudio,
  useTracks,
} from "@livekit/components-react";
import { Mic, MicOff, PhoneOff, Video, VideoOff, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MeetingKindIcon } from "./meeting-badges";
import { useCall, type ActiveCall } from "./call-provider";

/**
 * Floating card shown while a call is active and the user is anywhere but the call page itself
 * (bottom-right; QuestionDock owns bottom-left, toasts top-right). Dialogs (z-50) stay above it.
 */
export function CallMiniPlayer() {
  const { activeCall, room, leave } = useCall();
  const pathname = usePathname();
  if (!activeCall || !room || pathname === activeCall.callHref) return null;
  return (
    <RoomContext.Provider value={room}>
      <MiniPlayerCard call={activeCall} onLeave={leave} />
    </RoomContext.Provider>
  );
}

function MiniPlayerCard({ call, onLeave }: { call: ActiveCall; onLeave: () => Promise<void> }) {
  const t = useTranslations("meetings.call");
  const room = useRoomContext();
  const participants = useParticipants();
  const isRecording = useIsRecording();
  const connectionState = useConnectionState();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const cameraTracks = useTracks([Track.Source.Camera]);
  const { canPlayAudio } = useStartAudio({ room, props: {} });
  // Prefer a remote camera so the tile shows the person you're talking to, not yourself.
  const tile = cameraTracks.find((tr) => !tr.participant.isLocal) ?? cameraTracks[0];

  return (
    <div className="fixed bottom-4 right-4 z-40 w-72 overflow-hidden rounded-lg border bg-card text-card-foreground shadow-lg">
      <Link href={call.callHref} aria-label={t("mini.openCall")} className="flex items-center gap-2 border-b px-3 py-2 hover:bg-accent">
        <MeetingKindIcon kind={call.kind} className="shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{call.title}</span>
        {isRecording && <span className="size-1.5 shrink-0 rounded-full bg-red-500 animate-pulse" aria-label={t("recordingBadge")} />}
      </Link>
      {call.kind === "video" && (
        <div className="aspect-video bg-black">
          {tile ? (
            // Mirror the own camera like the prefabs do (remote tracks stay unmirrored).
            <VideoTrack trackRef={tile} className={tile.participant.isLocal ? "h-full w-full -scale-x-100 object-cover" : "h-full w-full object-cover"} />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-white/50">{t("mini.noVideo")}</div>
          )}
        </div>
      )}
      <div className="flex items-center gap-1 px-2 py-1.5">
        <Button
          variant="ghost"
          size="icon"
          title={isMicrophoneEnabled ? t("mini.mute") : t("mini.unmute")}
          onClick={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled).catch(() => {})}
        >
          {isMicrophoneEnabled ? <Mic className="size-4" /> : <MicOff className="size-4 text-red-500" />}
        </Button>
        {call.kind === "video" && (
          <Button
            variant="ghost"
            size="icon"
            title={isCameraEnabled ? t("mini.cameraOff") : t("mini.cameraOn")}
            onClick={() => localParticipant.setCameraEnabled(!isCameraEnabled).catch(() => {})}
          >
            {isCameraEnabled ? <Video className="size-4" /> : <VideoOff className="size-4 text-red-500" />}
          </Button>
        )}
        {!canPlayAudio && (
          <Button variant="outline" size="sm" onClick={() => void room.startAudio()}>
            <Volume2 className="size-4" /> {t("mini.enableAudio")}
          </Button>
        )}
        <span className="min-w-0 flex-1 truncate px-1 text-xs text-muted-foreground">
          {connectionState === ConnectionState.Connected ? t("liveWith", { count: participants.length }) : t("mini.reconnecting")}
        </span>
        <Button variant="ghost" size="icon" title={t("mini.leave")} className="text-red-600 hover:text-red-600" onClick={() => void onLeave()}>
          <PhoneOff className="size-4" />
        </Button>
      </div>
    </div>
  );
}
