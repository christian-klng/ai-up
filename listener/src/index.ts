import { fileURLToPath } from "node:url";
import { AutoSubscribe, cli, defineAgent, ServerOptions, type JobContext, type JobProcess, type VAD } from "@livekit/agents";
import * as silero from "@livekit/agents-plugin-silero";
import { ParticipantKind, RoomEvent, TrackKind, type RemoteParticipant, type RemoteTrack, type RemoteTrackPublication } from "@livekit/rtc-node";
import { LISTENER_AGENT_NAME, type ListenerDispatchMetadata, type ListenerSegment } from "../../src/lib/live-listener";
import { createAppClient, SegmentReporter } from "./app-client";
import { log } from "./log";
import { TrackTranscriber, type Utterance } from "./transcriber";

/**
 * AI-Up live listener (docs/live-ki-agenten.md, section 4).
 *
 * Registers at LiveKit under an explicit agent name; the app dispatches it into a meeting room. Per remote
 * audio track it runs VAD-gated streaming recognition and reports final segments to the app. It also
 * republishes each segment as `lk.transcription` so clients can show captions with `useTranscriptions()`.
 * No LLM, no database – all reasoning happens in the app's worker.
 */

type UserData = { vad: VAD };

export default defineAgent<UserData>({
  prewarm: async (proc: JobProcess<UserData>) => {
    // longer silence than the voice-agent default: people pause mid-sentence in meetings
    proc.userData.vad = await silero.VAD.load({ minSilenceDuration: 0.8, prefixPaddingDuration: 0.5 });
  },
  entry: async (ctx: JobContext<UserData>) => {
    const meta = parseMetadata(ctx.job.metadata);
    if (!meta) {
      log.error({ metadata: ctx.job.metadata }, "dispatch without meetingId – leaving");
      return;
    }
    const app = createAppClient(process.env);
    const config = await app.config(meta.meetingId);
    if (!config.active || !config.stt) {
      log.info({ meetingId: meta.meetingId, active: config.active, stt: !!config.stt }, "live AI not active for this meeting – leaving");
      return;
    }
    const stt = config.stt;

    await ctx.connect(undefined, AutoSubscribe.AUDIO_ONLY);
    const room = ctx.room;
    const session = await room.getSid();
    const reporter = new SegmentReporter(app, meta.meetingId);
    const transcribers = new Map<string, TrackTranscriber>();
    log.info({ meetingId: meta.meetingId, room: room.name, session }, "listening");

    const publishCaption = async (participant: RemoteParticipant, trackSid: string, text: string) => {
      try {
        const writer = await room.localParticipant!.streamText({
          topic: "lk.transcription",
          senderIdentity: participant.identity,
          attributes: { "lk.transcribed_track_id": trackSid, "lk.transcription_final": "true" },
        });
        await writer.write(text);
        await writer.close();
      } catch (err) {
        log.debug({ err: (err as Error).message }, "caption publish failed");
      }
    };

    const onUtterance = (participant: RemoteParticipant, trackSid: string) => (u: Utterance) => {
      const segment: ListenerSegment = {
        id: u.id,
        session,
        participantIdentity: participant.identity,
        speakerName: participant.name || participant.identity,
        trackSid,
        startedAt: u.startedAt.toISOString(),
        endedAt: u.endedAt.toISOString(),
        text: u.text,
        language: u.language,
      };
      reporter.add(segment);
      void publishCaption(participant, trackSid, u.text);
    };

    const start = (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
      if (track.kind !== TrackKind.KIND_AUDIO || participant.kind !== ParticipantKind.STANDARD) return;
      const sid = publication.sid!;
      if (transcribers.has(sid)) return;
      const t = new TrackTranscriber({
        track,
        vad: ctx.proc.userData.vad,
        stt,
        label: `${participant.identity}/${sid}`,
        onUtterance: onUtterance(participant, sid),
        onAudioSent: (s) => reporter.addAudio(s),
      });
      transcribers.set(sid, t);
      log.info({ participant: participant.identity, track: sid }, "transcribing track");
      void t.run().catch((err) => log.warn({ track: sid, err: (err as Error).message }, "transcriber stopped"));
    };
    const stop = (sid: string | undefined) => {
      if (!sid) return;
      const t = transcribers.get(sid);
      transcribers.delete(sid);
      void t?.close();
    };

    room.on(RoomEvent.TrackSubscribed, start);
    room.on(RoomEvent.TrackUnsubscribed, (_track, publication) => stop(publication.sid));
    room.on(RoomEvent.ParticipantDisconnected, (p) => {
      for (const pub of p.trackPublications.values()) stop(pub.sid);
    });
    // tracks that were already subscribed before the handlers were attached
    for (const p of room.remoteParticipants.values()) {
      for (const pub of p.trackPublications.values()) if (pub.track) start(pub.track, pub, p);
    }

    ctx.addShutdownCallback(async () => {
      await Promise.all([...transcribers.values()].map((t) => t.close()));
      transcribers.clear();
      await reporter.stop();
      log.info({ meetingId: meta.meetingId }, "listener finished");
    });
    room.on(RoomEvent.Disconnected, () => ctx.shutdown("room disconnected"));
  },
});

function parseMetadata(raw: string | undefined): ListenerDispatchMetadata | null {
  try {
    const m = JSON.parse(raw ?? "") as Partial<ListenerDispatchMetadata>;
    return typeof m.meetingId === "string" && m.meetingId ? { meetingId: m.meetingId } : null;
  } catch {
    return null;
  }
}

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: LISTENER_AGENT_NAME,
    wsURL: process.env.LIVEKIT_URL,
    apiKey: process.env.LIVEKIT_API_KEY,
    apiSecret: process.env.LIVEKIT_API_SECRET,
    // a few warm processes; each one hosts one meeting
    numIdleProcesses: Number(process.env.LISTENER_IDLE_PROCESSES ?? 1),
  }),
);
