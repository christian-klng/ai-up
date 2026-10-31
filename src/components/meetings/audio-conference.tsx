"use client";

import { useState } from "react";
import { Track } from "livekit-client";
import { LayoutContextProvider, ParticipantAudioTile, TrackLoop, useTracks, type WidgetState } from "@livekit/components-react";
import { CallChat, CallControlBar } from "./call-controls";

/**
 * LiveKit's `AudioConference` prefab, rebuilt for our translated control bar and chat (call-controls.tsx).
 * It reuses the video conference's outer classes so the chat follows the same responsive layout
 * (globals.css, container `call`): beside the tiles, below them, or over them.
 */
export function AudioConference() {
  const [widgetState, setWidgetState] = useState<WidgetState>({ showChat: false, unreadMessages: 0, showSettings: false });
  const tracks = useTracks([Track.Source.Microphone]);

  return (
    <div className="lk-video-conference">
      <LayoutContextProvider onWidgetChange={setWidgetState}>
        <div className="lk-video-conference-inner">
          {/* Same frame as before the rebuild: LiveKit's tile grid, centred and at most 3xl wide. */}
          <div className="mx-auto min-h-0 w-full max-w-3xl flex-1 p-4">
            <div className="lk-audio-conference-stage">
              <TrackLoop tracks={tracks}>
                <ParticipantAudioTile />
              </TrackLoop>
            </div>
          </div>
          <CallControlBar controls={{ microphone: true, chat: true }} />
        </div>
        <CallChat style={{ display: widgetState.showChat ? "grid" : "none" }} />
      </LayoutContextProvider>
    </div>
  );
}
