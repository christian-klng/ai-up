"use client";

import { useTranslations } from "next-intl";
import { ParticipantKind } from "livekit-client";
import { useIsRecording, useParticipants } from "@livekit/components-react";

/**
 * Whether anything captures this call right now: an egress recording, or the live listener (an agent
 * participant, docs/live-ki-agenten.md) that transcribes everyone. Both count as "being recorded" for the
 * people in the call, so both show the same red marker. Must render inside a RoomContext.
 */
export function useCallCapture(): { recording: boolean; transcribing: boolean } {
  const recording = useIsRecording();
  const participants = useParticipants();
  return { recording, transcribing: participants.some((p) => p.kind === ParticipantKind.AGENT) };
}

/** `recordingEnabled`: the meeting is set to record, shown even before the egress is up. */
export function CaptureBadge({ recordingEnabled }: { recordingEnabled: boolean }) {
  const t = useTranslations("meetings.call");
  const { recording, transcribing } = useCallCapture();
  const rec = recording || recordingEnabled;
  if (!rec && !transcribing) return null;
  const label = rec && transcribing ? t("captureBoth") : rec ? t("recordingBadge") : t("transcribingBadge");
  return (
    <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs text-red-600" title={transcribing ? t("transcribingHint") : undefined}>
      <span className="size-1.5 rounded-full bg-red-500 animate-pulse" />
      {label}
    </span>
  );
}
