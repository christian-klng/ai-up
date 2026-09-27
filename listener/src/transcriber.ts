import { randomUUID } from "node:crypto";
import { VADEventType, type VAD } from "@livekit/agents";
import { AudioStream, type AudioFrame, type Track } from "@livekit/rtc-node";
import { RealtimeTranscription } from "@mistralai/mistralai/extra/realtime";
import type { RealtimeConnection } from "@mistralai/mistralai/extra/realtime";
import type { ListenerSttConfig } from "../../src/lib/live-listener";
import { log } from "./log";

/** Mistral realtime expects 16 kHz mono PCM s16le. */
export const SAMPLE_RATE = 16_000;
/** Audio kept before the VAD fires, so the first syllable is not cut off. */
const PREROLL_SECONDS = 0.8;
/** Without speech for this long the recogniser connection is closed; it reopens on the next utterance. */
const IDLE_CLOSE_MS = 60_000;
/** After a flush, how long to wait for `transcription.done` before falling back to the streamed text. */
const DONE_TIMEOUT_MS = 6_000;

export type Utterance = { id: string; text: string; language: string | null; startedAt: Date; endedAt: Date };

export type TranscriberOptions = {
  track: Track;
  vad: VAD;
  stt: ListenerSttConfig;
  label: string;
  onUtterance: (u: Utterance) => void;
  /** seconds of audio sent to the recogniser (billing basis) */
  onAudioSent: (seconds: number) => void;
};

/**
 * One remote audio track → final utterances.
 *
 * The VAD gates what goes to the recogniser: only speech (plus a short pre-roll) is sent. Mistral bills
 * per second of audio received, so a muted-but-open microphone or a silent listener costs nothing –
 * with 30 participants that is the difference between 30× and ~1× the meeting length.
 */
export class TrackTranscriber {
  private readonly opts: TranscriberOptions;
  private closed = false;
  private speaking = false;
  private preroll: AudioFrame[] = [];
  private prerollSamples = 0;
  private conn: RealtimeConnection | null = null;
  private connecting: Promise<RealtimeConnection> | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  /** utterances flushed but not yet answered by `transcription.done`, oldest first */
  private pending: Array<{ startedAt: Date; endedAt: Date; timer: NodeJS.Timeout }> = [];
  private streamedText = "";
  private language: string | null = null;
  private speechStartedAt: Date | null = null;
  private sendChain: Promise<void> = Promise.resolve();

  constructor(opts: TranscriberOptions) {
    this.opts = opts;
  }

  private get dryRun() {
    return this.opts.stt.model === "dry-run";
  }

  async run(): Promise<void> {
    const vadStream = this.opts.vad.stream();
    const vadTask = (async () => {
      for await (const ev of vadStream) {
        if (this.closed) break;
        if (ev.type === VADEventType.START_OF_SPEECH) this.onSpeechStart();
        else if (ev.type === VADEventType.END_OF_SPEECH) this.onSpeechEnd();
      }
    })();
    const audio = new AudioStream(this.opts.track, { sampleRate: SAMPLE_RATE, numChannels: 1 });
    try {
      for await (const frame of audio) {
        if (this.closed) break;
        vadStream.pushFrame(frame);
        if (this.speaking) this.send([frame]);
        else this.remember(frame);
      }
    } finally {
      vadStream.close();
      await vadTask.catch(() => undefined);
      await this.close();
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.speaking) this.onSpeechEnd();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    // give outstanding flushes a moment to come back before the socket goes
    await Promise.race([this.waitPending(), new Promise((r) => setTimeout(r, DONE_TIMEOUT_MS))]);
    for (const p of this.pending.splice(0)) clearTimeout(p.timer);
    await this.disconnect();
  }

  private remember(frame: AudioFrame) {
    this.preroll.push(frame);
    this.prerollSamples += frame.samplesPerChannel;
    while (this.preroll.length > 1 && this.prerollSamples - this.preroll[0].samplesPerChannel >= PREROLL_SECONDS * SAMPLE_RATE) {
      this.prerollSamples -= this.preroll.shift()!.samplesPerChannel;
    }
  }

  private onSpeechStart() {
    if (this.speaking) return;
    this.speaking = true;
    const prerollSeconds = this.prerollSamples / SAMPLE_RATE;
    this.speechStartedAt = new Date(Date.now() - prerollSeconds * 1000);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const frames = this.preroll;
    this.preroll = [];
    this.prerollSamples = 0;
    this.send(frames);
  }

  private onSpeechEnd() {
    if (!this.speaking) return;
    this.speaking = false;
    const startedAt = this.speechStartedAt ?? new Date();
    const endedAt = new Date();
    if (this.dryRun) {
      const seconds = (endedAt.getTime() - startedAt.getTime()) / 1000;
      this.opts.onUtterance({ id: randomUUID(), text: `[speech ${seconds.toFixed(1)} s]`, language: null, startedAt, endedAt });
      return;
    }
    this.sendChain = this.sendChain.then(async () => {
      const conn = this.conn;
      if (!conn || conn.isClosed) return;
      await conn.flushAudio();
      const timer = setTimeout(() => this.resolvePending(null), DONE_TIMEOUT_MS);
      this.pending.push({ startedAt, endedAt, timer });
    }).catch((err) => log.warn({ track: this.opts.label, err: (err as Error).message }, "flush failed"));
    this.idleTimer = setTimeout(() => void this.disconnect(), IDLE_CLOSE_MS);
  }

  /** Frames are sent strictly in order; the connection is opened lazily on the first utterance. */
  private send(frames: AudioFrame[]) {
    if (frames.length === 0) return;
    if (this.dryRun) {
      for (const f of frames) this.opts.onAudioSent(f.samplesPerChannel / SAMPLE_RATE);
      return;
    }
    this.sendChain = this.sendChain.then(async () => {
      const conn = await this.connection();
      for (const f of frames) {
        const bytes = new Uint8Array(f.data.buffer, f.data.byteOffset, f.data.byteLength);
        await conn.sendAudio(bytes);
        this.opts.onAudioSent(f.samplesPerChannel / SAMPLE_RATE);
      }
    }).catch((err) => {
      log.warn({ track: this.opts.label, err: (err as Error).message }, "sending audio failed – reconnecting on next utterance");
      void this.disconnect();
    });
  }

  private async connection(): Promise<RealtimeConnection> {
    if (this.conn && !this.conn.isClosed) return this.conn;
    if (!this.connecting) {
      this.connecting = (async () => {
        const rt = new RealtimeTranscription({ apiKey: this.opts.stt.apiKey });
        const conn = await rt.connect(this.opts.stt.model, { timeoutMs: 10_000, audioFormat: { encoding: "pcm_s16le", sampleRate: SAMPLE_RATE } });
        this.conn = conn;
        void this.receive(conn);
        log.debug({ track: this.opts.label, requestId: conn.requestId }, "recogniser connected");
        return conn;
      })().finally(() => {
        this.connecting = null;
      });
    }
    return this.connecting;
  }

  private async receive(conn: RealtimeConnection) {
    try {
      for await (const ev of conn.events()) {
        switch (ev.type) {
          case "transcription.language":
            this.language = (ev as { audioLanguage?: string }).audioLanguage ?? this.language;
            break;
          case "transcription.text.delta":
            this.streamedText += (ev as { text?: string }).text ?? "";
            break;
          case "transcription.done": {
            const done = ev as { text?: string; language?: string | null };
            if (done.language) this.language = done.language;
            this.resolvePending(done.text ?? null);
            break;
          }
          case "error":
            log.warn({ track: this.opts.label, ev }, "recogniser error");
            break;
        }
      }
    } catch (err) {
      if (!this.closed) log.warn({ track: this.opts.label, err: (err as Error).message }, "recogniser stream ended");
    } finally {
      if (this.conn === conn) this.conn = null;
      // whatever was streamed but never confirmed still counts as an utterance
      while (this.pending.length > 0) this.resolvePending(null);
    }
  }

  /** Closes the oldest pending utterance – with the recogniser's final text, or the streamed deltas. */
  private resolvePending(finalText: string | null) {
    const p = this.pending.shift();
    const text = (finalText ?? this.streamedText).trim();
    this.streamedText = "";
    if (!p) return;
    clearTimeout(p.timer);
    if (text) this.opts.onUtterance({ id: randomUUID(), text, language: this.language, startedAt: p.startedAt, endedAt: p.endedAt });
  }

  private async waitPending() {
    while (this.pending.length > 0) await new Promise((r) => setTimeout(r, 100));
  }

  private async disconnect() {
    const conn = this.conn;
    this.conn = null;
    if (!conn || conn.isClosed) return;
    try {
      await conn.endAudio();
      await conn.close();
    } catch {
      /* already gone */
    }
  }
}
