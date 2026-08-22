"use client";

import "@livekit/components-styles";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AudioConference, LiveKitRoom, RoomAudioRenderer, VideoConference } from "@livekit/components-react";
import { Track } from "livekit-client";
import { toast } from "sonner";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { MeetingKindIcon } from "./meeting-badges";

type Props = {
  title: string;
  kind: "audio" | "video";
  token: string;
  serverUrl: string;
  backHref: string;
  recordingEnabled: boolean;
};

/**
 * In-app call using the LiveKit React prefabs. Video meetings get the full VideoConference layout
 * (tiles, screen share, chat); audio meetings a compact AudioConference. Leaving returns to the meeting page.
 */
export function MeetingCall({ title, kind, token, serverUrl, backHref, recordingEnabled }: Props) {
  const t = useTranslations("meetings.call");
  const router = useRouter();
  const [connecting, setConnecting] = useState(true);

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
        {connecting && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> {t("connecting")}
          </span>
        )}
      </header>
      <div className="min-h-0 flex-1 bg-black/95">
        <LiveKitRoom
          token={token}
          serverUrl={serverUrl}
          connect
          audio
          video={kind === "video"}
          onConnected={() => setConnecting(false)}
          onDisconnected={() => {
            router.push(backHref);
            router.refresh();
          }}
          onError={(e) => {
            // Device permission problems are not connection errors – say so.
            const devices = /NotAllowed|Permission|NotFound|NotReadable|device/i.test(`${e.name} ${e.message}`);
            toast.error(devices ? t("deviceError") : t("error", { message: e.message }));
          }}
          style={{ height: "100%" }}
        >
          {kind === "video" ? (
            <VideoConference />
          ) : (
            <div className="mx-auto flex h-full max-w-3xl flex-col justify-center p-4">
              <AudioConference />
            </div>
          )}
          <RoomAudioRenderer />
        </LiveKitRoom>
      </div>
      {/* keep Track import used for future source toggles */}
      <span className="hidden">{Track.Source.Microphone}</span>
    </div>
  );
}
