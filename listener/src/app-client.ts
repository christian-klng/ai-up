import {
  LISTENER_SIGNATURE_HEADER,
  LISTENER_TIMESTAMP_HEADER,
  signListenerRequest,
  type ListenerConfig,
  type ListenerSegment,
  type ListenerSegmentsBody,
} from "../../src/lib/live-listener";
import { log } from "./log";

/**
 * The listener's only link to the app: two signed HTTP calls. No database access on the media server.
 *
 * Without APP_URL it runs standalone for local tests: the recogniser key comes from MISTRAL_API_KEY and
 * segments are only logged.
 */
export type AppClient = {
  config(meetingId: string): Promise<ListenerConfig>;
  report(body: ListenerSegmentsBody): Promise<void>;
};

async function signedFetch(base: string, secret: string, method: "GET" | "POST", path: string, body?: unknown): Promise<Response> {
  const payload = body === undefined ? "" : JSON.stringify(body);
  const timestamp = String(Date.now());
  const res = await fetch(new URL(path, base), {
    method,
    headers: {
      "content-type": "application/json",
      [LISTENER_TIMESTAMP_HEADER]: timestamp,
      [LISTENER_SIGNATURE_HEADER]: signListenerRequest(secret, method, path, timestamp, payload),
    },
    body: body === undefined ? undefined : payload,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text().catch(() => "")}`.slice(0, 300));
  return res;
}

export function createAppClient(env: NodeJS.ProcessEnv): AppClient {
  const base = env.APP_URL;
  const secret = env.LISTENER_SHARED_SECRET ?? "";
  if (!base) {
    log.warn({}, "APP_URL not set – standalone mode: MISTRAL_API_KEY from env, segments are only logged");
    return {
      async config(meetingId) {
        return {
          meetingId,
          communityId: "standalone",
          active: true,
          language: env.LISTENER_LANGUAGE ?? "de",
          contextBias: [],
          // LISTENER_DRY_RUN=1: no recogniser, utterances only report their length (tests LiveKit + VAD for free)
          stt: env.LISTENER_DRY_RUN === "1" ? { provider: "mistral", apiKey: "", model: "dry-run" } : env.MISTRAL_API_KEY ? { provider: "mistral", apiKey: env.MISTRAL_API_KEY, model: env.MISTRAL_STT_MODEL ?? "voxtral-mini-transcribe-realtime-2602" } : null,
        };
      },
      async report(body) {
        for (const s of body.segments) log.info({ speaker: s.speakerName, text: s.text, lang: s.language, startedAt: s.startedAt, endedAt: s.endedAt }, "segment");
        if (body.audioSeconds > 0) log.info({ audioSeconds: Math.round(body.audioSeconds * 10) / 10 }, "usage");
      },
    };
  }
  if (!secret) throw new Error("LISTENER_SHARED_SECRET is required when APP_URL is set");
  return {
    async config(meetingId) {
      const res = await signedFetch(base, secret, "GET", `/api/internal/live/config?meetingId=${encodeURIComponent(meetingId)}`);
      return (await res.json()) as ListenerConfig;
    },
    async report(body) {
      await signedFetch(base, secret, "POST", "/api/internal/live/segments", body);
    },
  };
}

/** Buffers segments and reports them every few seconds; failed reports are retried with the next batch. */
export class SegmentReporter {
  private queue: ListenerSegment[] = [];
  private audioSeconds = 0;
  private timer: NodeJS.Timeout;
  private flushing: Promise<void> | null = null;

  constructor(
    private readonly client: AppClient,
    private readonly meetingId: string,
    intervalMs = 5_000,
  ) {
    this.timer = setInterval(() => void this.flush(), intervalMs);
  }

  add(segment: ListenerSegment) {
    this.queue.push(segment);
  }

  addAudio(seconds: number) {
    this.audioSeconds += seconds;
  }

  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (this.queue.length === 0 && this.audioSeconds < 1) return;
    const segments = this.queue.splice(0, 200);
    const audioSeconds = this.audioSeconds;
    this.audioSeconds = 0;
    this.flushing = this.client
      .report({ meetingId: this.meetingId, segments, audioSeconds })
      .catch((err) => {
        // keep the data for the next round; the app stores segments idempotently by id
        this.queue.unshift(...segments);
        this.audioSeconds += audioSeconds;
        log.warn({ meetingId: this.meetingId, err: (err as Error).message, queued: this.queue.length }, "report failed");
      })
      .finally(() => {
        this.flushing = null;
      });
    return this.flushing;
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    await this.flush();
    if (this.queue.length > 0) await this.flush();
  }
}
