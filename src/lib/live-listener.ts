import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Contract between the app and the live listener (`listener/`), which joins meeting rooms, transcribes
 * every participant and reports final segments back over HTTP (see docs/live-ki-agenten.md).
 * Pure module: used by the Next.js routes and bundled into the listener, so no `next/*`, no DB.
 */

/** Explicit-dispatch name the listener registers with at LiveKit. */
export const LISTENER_AGENT_NAME = "aiup-listener";

/** Metadata the app attaches to a dispatch. Kept tiny: it travels through the LiveKit server. */
export type ListenerDispatchMetadata = { meetingId: string };

export type ListenerSttConfig = { provider: "mistral"; apiKey: string; model: string };

/** What the listener fetches at job start (GET /api/internal/live/config). */
export type ListenerConfig = {
  meetingId: string;
  communityId: string;
  /** false = nothing to do (live AI switched off meanwhile) – the listener leaves the room */
  active: boolean;
  /** ISO 639-1 hint, empty = auto-detect */
  language: string;
  /** names and terms from the meeting that the recogniser should prefer */
  contextBias: string[];
  stt: ListenerSttConfig | null;
};

/** One final utterance of one participant. `id` is chosen by the listener, so re-sends are idempotent. */
export type ListenerSegment = {
  id: string;
  /** LiveKit room sid – separates the sessions of a reopened meeting */
  session: string;
  participantIdentity: string;
  speakerName: string;
  trackSid: string;
  startedAt: string;
  endedAt: string;
  text: string;
  language: string | null;
};

/** POST /api/internal/live/segments */
export type ListenerSegmentsBody = {
  meetingId: string;
  segments: ListenerSegment[];
  /** audio actually sent to the recogniser since the last report, in seconds */
  audioSeconds: number;
};

export const LISTENER_SIGNATURE_HEADER = "x-aiup-signature";
export const LISTENER_TIMESTAMP_HEADER = "x-aiup-timestamp";
/** Requests older (or newer) than this are rejected – replay protection without server-side state. */
export const LISTENER_MAX_SKEW_MS = 60_000;

function payload(method: string, path: string, timestamp: string, body: string): string {
  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${body}`;
}

/** HMAC-SHA256 over method, path (with query), timestamp and body. */
export function signListenerRequest(secret: string, method: string, path: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret).update(payload(method, path, timestamp, body)).digest("hex");
}

export function verifyListenerRequest(
  secret: string,
  req: { method: string; path: string; timestamp: string | null; signature: string | null; body: string },
  now = Date.now(),
): boolean {
  if (!secret || !req.timestamp || !req.signature) return false;
  const ts = Number(req.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > LISTENER_MAX_SKEW_MS) return false;
  const expected = Buffer.from(signListenerRequest(secret, req.method, req.path, req.timestamp, req.body), "hex");
  const given = Buffer.from(req.signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
