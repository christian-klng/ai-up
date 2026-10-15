"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Room, RoomEvent, Track } from "livekit-client";
import { RoomAudioRenderer } from "@livekit/components-react";
import { toast } from "sonner";
import { joinMeetingAction } from "@/server/actions/meetings";
import { useRealtimeEvent } from "@/components/realtime/realtime-provider";
import { applyNoiseFilter } from "@/components/meetings/noise-filter";
import { DEFAULT_NOISE_FILTER_LEVEL, NOISE_FILTER_STORAGE_KEY, parseNoiseFilterLevel, type NoiseFilterLevel } from "@/lib/noise-filter";

export type ActiveCall = {
  meetingId: string;
  spaceSlug: string;
  title: string;
  kind: "audio" | "video";
  isHost: boolean;
  callHref: string;
  backHref: string;
};

export type CallStatus = "idle" | "connecting" | "connected";
/** "loading" covers the first-time download of the DeepFilterNet assets (~24 MB, then browser-cached). */
export type NoiseFilterStatus = "idle" | "loading" | "active" | "failed";

type JoinInput = { meetingId: string; spaceSlug: string; title: string; kind: "audio" | "video" };
type JoinFailure = "notConfigured" | "notFound" | "ended" | "protocol" | "connect";

type CallContextValue = {
  activeCall: ActiveCall | null;
  status: CallStatus;
  room: Room | null;
  join: (m: JoinInput) => Promise<{ ok: true } | { ok: false; error: JoinFailure }>;
  leave: () => Promise<void>;
  noiseFilter: NoiseFilterLevel;
  noiseFilterStatus: NoiseFilterStatus;
  setNoiseFilter: (level: NoiseFilterLevel) => void;
};

function readStoredNoiseFilter(): NoiseFilterLevel {
  try {
    return parseNoiseFilterLevel(localStorage.getItem(NOISE_FILTER_STORAGE_KEY));
  } catch {
    return DEFAULT_NOISE_FILTER_LEVEL;
  }
}

const CallContext = createContext<CallContextValue | null>(null);

/**
 * Owns the single LiveKit Room for the tab so a call survives in-app navigation; the call page and
 * the mini player render against this room via RoomContext, never a second connection (same identity
 * would evict the first). Mounted in the (app) shell – navigating to the sibling /admin layout
 * unmounts it and cleanly disconnects.
 */
export function CallProvider({ children }: { children: React.ReactNode }) {
  const t = useTranslations("meetings.call");
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [status, setStatus] = useState<CallStatus>("idle");
  const [room, setRoom] = useState<Room | null>(null);
  const activeCallRef = useRef<ActiveCall | null>(null);
  const roomRef = useRef<Room | null>(null);
  // The noise filter level belongs to this device, not to a call: it is read once and kept across calls.
  const [noiseFilter, setNoiseFilterState] = useState<NoiseFilterLevel>(readStoredNoiseFilter);
  const [noiseFilterStatus, setNoiseFilterStatus] = useState<NoiseFilterStatus>("idle");
  const noiseFilterRef = useRef(noiseFilter);
  const noiseFilterChain = useRef<Promise<void>>(Promise.resolve());

  const leave = useCallback(async () => {
    const current = roomRef.current;
    roomRef.current = null;
    activeCallRef.current = null;
    setRoom(null);
    setActiveCall(null);
    setStatus("idle");
    setNoiseFilterStatus("idle");
    if (current) await current.disconnect();
  }, []);

  // Brings the mic track in line with the chosen level. Runs one at a time and reads the level when it
  // starts, so clicking around while the model is still loading ends on the last choice, not a race.
  const syncNoiseFilter = useCallback(
    (target: Room) => {
      noiseFilterChain.current = noiseFilterChain.current.then(async () => {
        const track = target.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
        if (!track || roomRef.current !== target) return;
        const level = noiseFilterRef.current;
        setNoiseFilterStatus(level === "standard" ? "idle" : "loading");
        try {
          await applyNoiseFilter(track, level);
          if (roomRef.current === target) setNoiseFilterStatus(level === "standard" ? "idle" : "active");
        } catch {
          // The choice stays saved; the next call tries again. Until then the browser filter applies.
          await track.stopProcessor().catch(() => {});
          if (roomRef.current === target) setNoiseFilterStatus("failed");
          toast.error(t("noiseFilter.failed"));
        }
      });
    },
    [t]
  );

  const setNoiseFilter = useCallback(
    (level: NoiseFilterLevel) => {
      noiseFilterRef.current = level;
      setNoiseFilterState(level);
      try {
        localStorage.setItem(NOISE_FILTER_STORAGE_KEY, level);
      } catch {
        // private mode / blocked storage: the choice holds for this tab only
      }
      if (roomRef.current) syncNoiseFilter(roomRef.current);
    },
    [syncNoiseFilter]
  );

  const join = useCallback(
    async (m: JoinInput): Promise<{ ok: true } | { ok: false; error: JoinFailure }> => {
      if (activeCallRef.current?.meetingId === m.meetingId) return { ok: true };
      if (roomRef.current) await leave();
      setStatus("connecting");
      const res = await joinMeetingAction(m.meetingId);
      if (!res.ok) {
        setStatus("idle");
        return res;
      }
      const next = new Room({ adaptiveStream: true, dynacast: true });
      next.on(RoomEvent.Disconnected, () => {
        // Single teardown path (leave button, server-side room deletion, lost connection).
        if (roomRef.current !== next) return;
        roomRef.current = null;
        activeCallRef.current = null;
        setRoom(null);
        setActiveCall(null);
        setStatus("idle");
        setNoiseFilterStatus("idle");
      });
      // Covers the first publish and a mic that is only allowed later in the call.
      next.on(RoomEvent.LocalTrackPublished, (pub) => {
        if (pub.source === Track.Source.Microphone) syncNoiseFilter(next);
      });
      next.on(RoomEvent.MediaDevicesError, () => toast.error(t("deviceError")));
      try {
        await next.connect(res.url, res.token);
      } catch {
        await next.disconnect();
        setStatus("idle");
        return { ok: false, error: "connect" };
      }
      const call: ActiveCall = {
        meetingId: m.meetingId,
        spaceSlug: m.spaceSlug,
        title: m.title,
        kind: m.kind,
        isHost: res.isHost,
        callHref: `/meetings/${m.spaceSlug}/${m.meetingId}/call`,
        backHref: `/meetings/${m.spaceSlug}/${m.meetingId}`,
      };
      roomRef.current = next;
      activeCallRef.current = call;
      setRoom(next);
      setActiveCall(call);
      setStatus("connected");
      try {
        await next.localParticipant.setMicrophoneEnabled(true);
        if (m.kind === "video") await next.localParticipant.setCameraEnabled(true);
      } catch {
        // Stay connected without devices; MediaDevicesError already toasts.
      }
      return { ok: true };
    },
    [leave, syncNoiseFilter, t]
  );

  useRealtimeEvent("meeting.updated", (p) => {
    if (p.meetingId === activeCallRef.current?.meetingId && p.status === "ended") {
      toast(t("mini.endedRemotely"));
      void leave();
    }
  });

  // Warn before closing the tab mid-call; the LiveKit webhook handles the actual departure.
  useEffect(() => {
    if (!room) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [room]);

  // Disconnect when the shell unmounts (e.g. navigating into /admin) so no ghost participant lingers.
  useEffect(
    () => () => {
      void roomRef.current?.disconnect();
    },
    []
  );

  const value = useMemo(
    () => ({ activeCall, status, room, join, leave, noiseFilter, noiseFilterStatus, setNoiseFilter }),
    [activeCall, status, room, join, leave, noiseFilter, noiseFilterStatus, setNoiseFilter]
  );
  return (
    <CallContext.Provider value={value}>
      {children}
      {room && <RoomAudioRenderer room={room} />}
    </CallContext.Provider>
  );
}

export function useCall(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used inside CallProvider");
  return ctx;
}
