"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type HTMLAttributes } from "react";
import { useTranslations } from "next-intl";
import { Track } from "livekit-client";
import {
  ChatCloseIcon,
  ChatEntry,
  ChatIcon,
  ChatToggle,
  DisconnectButton,
  LeaveIcon,
  MediaDeviceMenu,
  StartMediaButton,
  TrackToggle,
  formatChatMessageLinks,
  useChat,
  useLocalParticipantPermissions,
  useMaybeLayoutContext,
  usePersistentUserChoices,
} from "@livekit/components-react";

/*
 * LiveKit's `ControlBar` and `Chat` prefabs (components-react 2.9) hard-code their English labels and
 * take no translations, so both are rebuilt here from the same public pieces, with our texts. Markup
 * and class names follow the prefabs, so LiveKit's styles and our theme in globals.css still apply.
 */

/** LiveKit's numeric source ids in `canPublishSources` (TrackSource in the protocol). */
const SOURCE_ID: Partial<Record<Track.Source, number>> = { [Track.Source.Camera]: 1, [Track.Source.Microphone]: 2, [Track.Source.ScreenShare]: 3 };

function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

function canShareScreen(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;
}

/**
 * The control bar: microphone and camera (each with a device menu), screen share, chat, leave. Leaving
 * asks first – one stray click on the red button used to drop people out of the call. The prefab's
 * leave button disconnects in its own onClick; stopping the click in the capture phase keeps it from
 * ever getting there when the confirmation is declined.
 */
export function CallControlBar({ controls }: { controls: { microphone?: boolean; camera?: boolean; screenShare?: boolean; chat?: boolean } }) {
  const t = useTranslations("meetings.call");
  const layout = useMaybeLayoutContext();
  const chatOpen = !!layout?.widget.state?.showChat;
  // Same rule as the prefab: icons only on narrow viewports, a little earlier while the chat takes room.
  const minimal = useMediaQuery(`(max-width: ${chatOpen ? 1000 : 760}px)`);
  const [sharing, setSharing] = useState(false);
  const permissions = useLocalParticipantPermissions();
  const { saveAudioInputEnabled, saveVideoInputEnabled, saveAudioInputDeviceId, saveVideoInputDeviceId } = usePersistentUserChoices();

  const canPublish = (source: Track.Source) => !!permissions?.canPublish && (permissions.canPublishSources.length === 0 || permissions.canPublishSources.includes(SOURCE_ID[source] ?? -1));
  const show = {
    microphone: !!controls.microphone && canPublish(Track.Source.Microphone),
    camera: !!controls.camera && canPublish(Track.Source.Camera),
    screenShare: !!controls.screenShare && canPublish(Track.Source.ScreenShare) && canShareScreen(),
    chat: !!controls.chat && !!permissions?.canPublishData,
  };
  const label = (text: string) => (minimal ? null : text);

  return (
    <div
      className="lk-control-bar"
      onClickCapture={(e) => {
        if ((e.target as HTMLElement).closest(".lk-disconnect-button") && !confirm(t("confirmLeave"))) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      {show.microphone && (
        <div className="lk-button-group">
          <TrackToggle source={Track.Source.Microphone} showIcon onChange={(enabled, byUser) => byUser && saveAudioInputEnabled(enabled)}>
            {label(t("controls.microphone"))}
          </TrackToggle>
          <div className="lk-button-group-menu">
            <MediaDeviceMenu kind="audioinput" aria-label={t("controls.microphoneDevice")} onActiveDeviceChange={(_kind, id) => saveAudioInputDeviceId(id ?? "default")} />
          </div>
        </div>
      )}
      {show.camera && (
        <div className="lk-button-group">
          <TrackToggle source={Track.Source.Camera} showIcon onChange={(enabled, byUser) => byUser && saveVideoInputEnabled(enabled)}>
            {label(t("controls.camera"))}
          </TrackToggle>
          <div className="lk-button-group-menu">
            <MediaDeviceMenu kind="videoinput" aria-label={t("controls.cameraDevice")} onActiveDeviceChange={(_kind, id) => saveVideoInputDeviceId(id ?? "default")} />
          </div>
        </div>
      )}
      {show.screenShare && (
        <TrackToggle source={Track.Source.ScreenShare} captureOptions={{ audio: true, selfBrowserSurface: "include" }} showIcon onChange={setSharing}>
          {label(sharing ? t("controls.stopShare") : t("controls.shareScreen"))}
        </TrackToggle>
      )}
      {show.chat && (
        <ChatToggle aria-label={minimal ? t("controls.chat") : undefined}>
          <ChatIcon />
          {label(t("controls.chat"))}
        </ChatToggle>
      )}
      <DisconnectButton aria-label={minimal ? t("controls.leave") : undefined}>
        <LeaveIcon />
        {label(t("controls.leave"))}
      </DisconnectButton>
      <StartMediaButton label={t("controls.startMedia")} />
    </div>
  );
}

/** The chat panel: header with close button, messages (links clickable), input. Messages live only as long as the call. */
export function CallChat(props: HTMLAttributes<HTMLDivElement>) {
  const t = useTranslations("meetings.call.chat");
  const { chatMessages, send, isSending } = useChat();
  const layout = useMaybeLayoutContext();
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastSeen = useRef(0);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [chatMessages]);

  // Unread counter on the chat button, as in the prefab: everything newer than the last message seen open.
  useEffect(() => {
    if (!layout || chatMessages.length === 0) return;
    const newest = chatMessages[chatMessages.length - 1].timestamp;
    if (layout.widget.state?.showChat) {
      lastSeen.current = newest;
      return;
    }
    const unread = chatMessages.filter((m) => m.timestamp > lastSeen.current).length;
    if (unread > 0 && layout.widget.state?.unreadMessages !== unread) layout.widget.dispatch?.({ msg: "unread_msg", count: unread });
  }, [chatMessages, layout]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const input = inputRef.current;
    if (!input || input.value.trim() === "") return;
    await send(input.value);
    input.value = "";
    input.focus();
  }

  return (
    <div {...props} className="lk-chat">
      <div className="lk-chat-header">
        {t("title")}
        {layout && (
          <ChatToggle className="lk-close-button" aria-label={t("close")}>
            <ChatCloseIcon />
          </ChatToggle>
        )}
      </div>
      <ul className="lk-list lk-chat-messages" ref={listRef}>
        {chatMessages.map((msg, i, all) => {
          const sameSender = i > 0 && all[i - 1].from === msg.from;
          const withinMinute = i > 0 && msg.timestamp - all[i - 1].timestamp < 60_000;
          return <ChatEntry key={msg.id ?? i} entry={msg} hideName={sameSender} hideTimestamp={sameSender && withinMinute} messageFormatter={formatChatMessageLinks} />;
        })}
      </ul>
      <form className="lk-chat-form" onSubmit={submit}>
        {/* Keys stay in the input – LiveKit's shortcuts would otherwise react to typing. */}
        <input
          ref={inputRef}
          className="lk-form-control lk-chat-form-input"
          type="text"
          disabled={isSending}
          placeholder={t("placeholder")}
          aria-label={t("placeholder")}
          onInput={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onKeyUp={(e) => e.stopPropagation()}
        />
        <button type="submit" className="lk-button lk-chat-form-button" disabled={isSending}>
          {t("send")}
        </button>
      </form>
    </div>
  );
}
