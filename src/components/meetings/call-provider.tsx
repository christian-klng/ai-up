"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Room, RoomEvent } from "livekit-client";
import { RoomAudioRenderer } from "@livekit/components-react";
import { toast } from "sonner";
import { joinMeetingAction } from "@/server/actions/meetings";
import { useRealtimeEvent } from "@/components/realtime/realtime-provider";

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

type JoinInput = { meetingId: string; spaceSlug: string; title: string; kind: "audio" | "video" };
type JoinFailure = "notConfigured" | "notFound" | "ended" | "protocol" | "connect";

type CallContextValue = {
  activeCall: ActiveCall | null;
  status: CallStatus;
  room: Room | null;
  join: (m: JoinInput) => Promise<{ ok: true } | { ok: false; error: JoinFailure }>;
  leave: () => Promise<void>;
};

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

  const leave = useCallback(async () => {
    const current = roomRef.current;
    roomRef.current = null;
    activeCallRef.current = null;
    setRoom(null);
    setActiveCall(null);
    setStatus("idle");
    if (current) await current.disconnect();
  }, []);

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
    [leave, t]
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

  const value = useMemo(() => ({ activeCall, status, room, join, leave }), [activeCall, status, room, join, leave]);
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
