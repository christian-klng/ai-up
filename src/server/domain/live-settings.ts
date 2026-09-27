import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { communityLiveSettings, meetingLiveUsage, meetingTranscriptSegments, users } from "@/server/db/schema";
import { decryptSecret, encryptSecret, maskSecret } from "@/server/crypto";
import { communityOfMeeting } from "@/server/domain/meetings";
import { env } from "@/server/env";
import { logger } from "@/server/logger";
import type { ListenerConfig, ListenerSegmentsBody, ListenerSttConfig } from "@/lib/live-listener";

/**
 * Live AI in meetings – per-community settings, the listener's config and the segments it reports
 * (docs/live-ki-agenten.md). Shared by admin actions and the internal listener routes; no `next/*`.
 */

export const DEFAULT_STT_MODEL = "voxtral-mini-transcribe-realtime-2602";
const MISTRAL_API = "https://api.mistral.ai/v1";

type Row = typeof communityLiveSettings.$inferSelect;

async function loadRow(communityId: string): Promise<Row | undefined> {
  return db.query.communityLiveSettings.findFirst({ where: eq(communityLiveSettings.communityId, communityId) });
}

function decryptKey(row: Row | undefined): string | null {
  if (!row?.sttApiKeyEncrypted) return null;
  try {
    return decryptSecret(row.sttApiKeyEncrypted);
  } catch {
    logger.warn({ communityId: row.communityId }, "live transcription key cannot be decrypted (APP_ENCRYPTION_KEY changed?)");
    return null;
  }
}

/** Admin view: never the key itself, only whether one is stored and its last four characters. */
export async function getLiveSettingsView(communityId: string) {
  const row = await loadRow(communityId);
  const key = decryptKey(row);
  return {
    enabled: row?.enabled ?? false,
    sttProvider: row?.sttProvider ?? "mistral",
    sttModel: row?.sttModel ?? DEFAULT_STT_MODEL,
    hasKey: !!key,
    keyMasked: key ? maskSecret(key) : null,
    checkedAt: row?.sttCheckedAt ?? null,
    lastError: row?.sttLastError ?? null,
  };
}
export type LiveSettingsView = Awaited<ReturnType<typeof getLiveSettingsView>>;

/** `apiKey`: undefined keeps the stored key, "" removes it, anything else replaces it. */
export async function saveLiveSettings(communityId: string, input: { enabled: boolean; sttModel: string; apiKey?: string }): Promise<void> {
  const keyPatch =
    input.apiKey === undefined ? {} : { sttApiKeyEncrypted: input.apiKey ? encryptSecret(input.apiKey) : null, sttCheckedAt: null, sttLastError: null };
  await db
    .insert(communityLiveSettings)
    .values({ communityId, enabled: input.enabled, sttModel: input.sttModel, ...keyPatch })
    .onConflictDoUpdate({ target: communityLiveSettings.communityId, set: { enabled: input.enabled, sttModel: input.sttModel, ...keyPatch } });
}

/** The recogniser credentials of a community, or null while live transcription is off or has no key. */
export async function sttCredentials(communityId: string): Promise<ListenerSttConfig | null> {
  const row = await loadRow(communityId);
  const key = decryptKey(row);
  if (!row?.enabled || !key) return null;
  return { provider: row.sttProvider, apiKey: key, model: row.sttModel };
}

/**
 * Checks the stored key against Mistral's model list and remembers the outcome. Listing models is free,
 * so the check costs nothing; it also tells whether the configured realtime model is available.
 */
export async function checkSttKey(communityId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await loadRow(communityId);
  const key = decryptKey(row);
  if (!row || !key) return { ok: false, error: "no key" };
  let error: string | null = null;
  try {
    const res = await fetch(`${MISTRAL_API}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10_000) });
    if (res.status === 401 || res.status === 403) error = "key rejected";
    else if (!res.ok) error = `HTTP ${res.status}`;
    else {
      const body = (await res.json()) as { data?: Array<{ id: string }> };
      const ids = new Set((body.data ?? []).map((m) => m.id));
      if (ids.size > 0 && !ids.has(row.sttModel)) error = `model "${row.sttModel}" not available for this key`;
    }
  } catch (err) {
    error = (err as Error).message;
  }
  await db.update(communityLiveSettings).set({ sttCheckedAt: new Date(), sttLastError: error }).where(eq(communityLiveSettings.communityId, communityId));
  return error ? { ok: false, error } : { ok: true };
}

/** What the listener gets at job start. Undefined = unknown meeting. */
export async function listenerConfig(meetingId: string): Promise<ListenerConfig | undefined> {
  const communityId = await communityOfMeeting(meetingId);
  if (!communityId) return undefined;
  const stt = await sttCredentials(communityId);
  return { meetingId, communityId, active: !!stt, language: "de", contextBias: [], stt };
}

function dayIn(timeZone: string, at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** Stores reported segments (idempotent by id) and adds the audio seconds to the day's usage. */
export async function recordListenerReport(body: ListenerSegmentsBody): Promise<{ stored: number } | undefined> {
  const communityId = await communityOfMeeting(body.meetingId);
  if (!communityId) return undefined;
  let stored = 0;
  if (body.segments.length > 0) {
    // identities are user ids for app participants; anything else (tests, future guests) stays unlinked
    const identities = [...new Set(body.segments.map((s) => s.participantIdentity))];
    const known = new Set((await db.select({ id: users.id }).from(users).where(inArray(users.id, identities))).map((u) => u.id));
    const rows = await db
      .insert(meetingTranscriptSegments)
      .values(
        body.segments.map((s) => ({
          id: s.id,
          meetingId: body.meetingId,
          session: s.session,
          userId: known.has(s.participantIdentity) ? s.participantIdentity : null,
          speakerName: s.speakerName.slice(0, 200),
          trackSid: s.trackSid,
          startedAt: new Date(s.startedAt),
          endedAt: new Date(s.endedAt),
          text: s.text.slice(0, 10_000),
          language: s.language,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: meetingTranscriptSegments.id });
    stored = rows.length;
  }
  const seconds = Math.round(body.audioSeconds);
  if (seconds > 0) {
    await db
      .insert(meetingLiveUsage)
      .values({ communityId, meetingId: body.meetingId, day: dayIn(env.APP_TIMEZONE), audioSeconds: seconds })
      .onConflictDoUpdate({
        target: [meetingLiveUsage.communityId, meetingLiveUsage.meetingId, meetingLiveUsage.day],
        set: { audioSeconds: sql`${meetingLiveUsage.audioSeconds} + ${seconds}` },
      });
  }
  return { stored };
}
