"use client";

import { useEffect, useRef, useState } from "react";
import { ParticipantKind, RoomEvent, Track } from "livekit-client";
import {
  CarouselLayout,
  Chat,
  ConnectionStateToast,
  ControlBar,
  FocusLayout,
  FocusLayoutContainer,
  GridLayout,
  LayoutContextProvider,
  ParticipantTile,
  isTrackReference,
  useCreateLayoutContext,
  usePinnedTracks,
  useTracks,
  type TrackReferenceOrPlaceholder,
  type WidgetState,
} from "@livekit/components-react";

function sameTrack(a: TrackReferenceOrPlaceholder | undefined, b: TrackReferenceOrPlaceholder | undefined): boolean {
  if (!a || !b) return false;
  return a.participant.identity === b.participant.identity && a.source === b.source && a.publication?.trackSid === b.publication?.trackSid;
}

/**
 * LiveKit's `VideoConference` prefab (components-react 2.9), rebuilt for one change: agent participants
 * get no tile. The live listener (docs/live-ki-agenten.md) joins as an agent without camera and would
 * otherwise show up as an empty placeholder tile. Everything else follows the prefab: grid, auto-focus on
 * screen share, pinning, chat, control bar.
 *
 * No `RoomAudioRenderer` here: CallProvider already renders one for the shared room, a second one would
 * play every voice twice.
 */
export function VideoConference() {
  const [widgetState, setWidgetState] = useState<WidgetState>({ showChat: false, unreadMessages: 0, showSettings: false });
  const lastAutoFocused = useRef<TrackReferenceOrPlaceholder | null>(null);

  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { updateOnlyOn: [RoomEvent.ActiveSpeakersChanged], onlySubscribed: false },
  ).filter((tr) => tr.participant.kind !== ParticipantKind.AGENT);

  const layoutContext = useCreateLayoutContext();
  const screenShareTracks = tracks.filter(isTrackReference).filter((tr) => tr.publication.source === Track.Source.ScreenShare);
  const focusTrack = usePinnedTracks(layoutContext)?.[0];
  const carouselTracks = tracks.filter((tr) => !sameTrack(tr, focusTrack));

  const screenShareKey = screenShareTracks.map((ref) => `${ref.publication.trackSid}_${ref.publication.isSubscribed}`).join();
  useEffect(() => {
    // pin a new screen share automatically, unless something is pinned by hand
    if (screenShareTracks.some((tr) => tr.publication.isSubscribed) && lastAutoFocused.current === null) {
      layoutContext.pin.dispatch?.({ msg: "set_pin", trackReference: screenShareTracks[0] });
      lastAutoFocused.current = screenShareTracks[0];
    } else if (lastAutoFocused.current && !screenShareTracks.some((tr) => tr.publication.trackSid === lastAutoFocused.current?.publication?.trackSid)) {
      layoutContext.pin.dispatch?.({ msg: "clear_pin" });
      lastAutoFocused.current = null;
    }
    if (focusTrack && !isTrackReference(focusTrack)) {
      const updated = tracks.find((tr) => tr.participant.identity === focusTrack.participant.identity && tr.source === focusTrack.source);
      if (updated !== focusTrack && updated && isTrackReference(updated)) layoutContext.pin.dispatch?.({ msg: "set_pin", trackReference: updated });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- same dependency set as the LiveKit prefab
  }, [screenShareKey, focusTrack?.publication?.trackSid, tracks]);

  return (
    <div className="lk-video-conference">
      <LayoutContextProvider value={layoutContext} onWidgetChange={setWidgetState}>
        <div className="lk-video-conference-inner">
          {!focusTrack ? (
            <div className="lk-grid-layout-wrapper">
              <GridLayout tracks={tracks}>
                <ParticipantTile />
              </GridLayout>
            </div>
          ) : (
            <div className="lk-focus-layout-wrapper">
              <FocusLayoutContainer>
                <CarouselLayout tracks={carouselTracks}>
                  <ParticipantTile />
                </CarouselLayout>
                {focusTrack && <FocusLayout trackRef={focusTrack} />}
              </FocusLayoutContainer>
            </div>
          )}
          <ControlBar controls={{ chat: true, settings: false }} />
        </div>
        <Chat style={{ display: widgetState.showChat ? "grid" : "none" }} />
      </LayoutContextProvider>
      <ConnectionStateToast />
    </div>
  );
}
