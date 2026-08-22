import path from "node:path";
import { access } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { EgressClient, EncodedFileOutput, EncodedFileType, type WebhookEvent } from "livekit-server-sdk";
import { db } from "@/server/db/client";
import { meetings, type Meeting } from "@/server/db/schema";
import { getLiveKitConfig, livekitHttpUrl } from "@/server/domain/integrations";
import { getSpaceById } from "@/server/domain/meetings";
import { emitDomainEvent } from "@/server/events/bus";
import { publishBroadcast } from "@/server/realtime/publish";
import { storeFileFromPath } from "@/server/media/storage";
import { logger } from "@/server/logger";

/**
 * Audio-only recording of meetings via LiveKit Room Composite Egress.
 *  - started automatically when the first participant joins (if the meeting has recording enabled)
 *    or manually by the host; stopped when the room ends or by the host
 *  - egress writes `/out/<room>/<file>.ogg` (egress container) = `<recordingsPath>/<room>/<file>.ogg`
 *    (app container, same host directory mounted) → imported into media_files on `egress_ended`
 */
const EGRESS_STATUS = ["STARTING", "ACTIVE", "ENDING", "COMPLETE", "FAILED", "ABORTED", "LIMIT_REACHED"] as const;

async function egressClient(): Promise<EgressClient | null> {
  const cfg = await getLiveKitConfig();
  if (!cfg || !cfg.enabled) return null;
  return new EgressClient(livekitHttpUrl(cfg.url), cfg.apiKey, cfg.apiSecret);
}

async function broadcast(m: Meeting) {
  const space = await getSpaceById(m.spaceId);
  await publishBroadcast("meeting.updated", { meetingId: m.id, spaceId: m.spaceId, spaceSlug: space?.slug ?? "", status: m.status, participantCount: m.participantCount, recordingStatus: m.recordingStatus });
}

export async function startRecording(meeting: Meeting, opts: { manual?: boolean } = {}): Promise<{ ok: true; egressId: string } | { ok: false; error: string }> {
  const client = await egressClient();
  if (!client || !meeting.roomName) return { ok: false, error: "not configured" };
  if (meeting.recordingStatus === "recording") return { ok: true, egressId: meeting.recordingEgressId ?? "" };
  const filepath = `/out/${meeting.roomName}/${meeting.id}-{time}.ogg`;
  try {
    const info = await client.startRoomCompositeEgress(meeting.roomName, { file: new EncodedFileOutput({ fileType: EncodedFileType.OGG, filepath }) }, { audioOnly: true });
    const [m] = await db.update(meetings).set({ recordingStatus: "recording", recordingEgressId: info.egressId, recordingError: null, recordingEnabled: opts.manual ? true : meeting.recordingEnabled }).where(eq(meetings.id, meeting.id)).returning();
    await broadcast(m);
    logger.info({ meetingId: meeting.id, egressId: info.egressId }, "recording started");
    return { ok: true, egressId: info.egressId };
  } catch (err) {
    const message = (err as Error).message;
    const [m] = await db.update(meetings).set({ recordingStatus: "failed", recordingError: message.slice(0, 500) }).where(eq(meetings.id, meeting.id)).returning();
    await broadcast(m);
    logger.warn({ meetingId: meeting.id, err: message }, "recording start failed");
    return { ok: false, error: message };
  }
}

export async function stopRecording(meeting: Meeting): Promise<void> {
  if (meeting.recordingStatus !== "recording" || !meeting.recordingEgressId) return;
  const client = await egressClient();
  if (!client) return;
  try {
    await client.stopEgress(meeting.recordingEgressId);
    const [m] = await db.update(meetings).set({ recordingStatus: "processing" }).where(eq(meetings.id, meeting.id)).returning();
    await broadcast(m);
  } catch (err) {
    // already stopped/finished – egress_ended will reconcile
    logger.info({ meetingId: meeting.id, err: (err as Error).message }, "stopRecording: stopEgress failed/ignored");
  }
}

/** Maps an egress container path (/out/...) to the app's view of the shared recordings directory. */
export function localRecordingPath(recordingsPath: string, egressPath: string): string {
  const rel = egressPath.replace(/^\/out\/?/, "");
  return path.join(/*turbopackIgnore: true*/ recordingsPath, rel);
}

export async function handleEgressEvent(meeting: Meeting, ev: WebhookEvent): Promise<void> {
  const info = ev.egressInfo;
  if (!info) return;
  if (meeting.recordingEgressId && info.egressId !== meeting.recordingEgressId) {
    logger.debug({ meetingId: meeting.id, egressId: info.egressId }, "egress event for another egress – ignored");
    return;
  }
  const status = EGRESS_STATUS[Number(info.status)] ?? String(info.status);
  if (ev.event === "egress_started" || ev.event === "egress_updated") {
    if (status === "ACTIVE" && meeting.recordingStatus !== "recording") {
      const [m] = await db.update(meetings).set({ recordingStatus: "recording", recordingEgressId: info.egressId }).where(eq(meetings.id, meeting.id)).returning();
      await broadcast(m);
    }
    return;
  }
  // egress_ended
  if (status === "COMPLETE") {
    const file = info.fileResults?.[0];
    const cfg = await getLiveKitConfig();
    if (!file || !cfg) {
      await fail(meeting, "egress finished without file result");
      return;
    }
    const source = localRecordingPath(cfg.recordingsPath, file.filename);
    try {
      await access(source);
    } catch {
      await fail(meeting, `recording file not found at ${source} – is the recordings directory mounted in the app?`);
      return;
    }
    const durationSeconds = file.duration ? Math.round(Number(file.duration) / 1e9) : null;
    const media = await storeFileFromPath({ sourcePath: source, mime: "audio/ogg", originalName: `${meeting.title.replace(/[^\w\-äöüÄÖÜß ]+/g, "").trim() || "meeting"}.ogg`, purpose: "recording", uploadedBy: meeting.hostId, durationSeconds });
    const [m] = await db.update(meetings).set({ recordingStatus: "available", recordingMediaId: media.id, recordingError: null }).where(eq(meetings.id, meeting.id)).returning();
    await broadcast(m);
    const space = await getSpaceById(m.spaceId);
    emitDomainEvent("meeting.recording.available", {
      meeting: { id: m.id, title: m.title, kind: m.kind, status: m.status, spaceId: m.spaceId, spaceSlug: space?.slug ?? "", spaceName: space?.name ?? "", hostId: m.hostId, href: `/meetings/${space?.slug ?? m.spaceId}/${m.id}` },
      mediaId: media.id,
      durationSeconds,
      actorId: null,
      origin: { kind: "system" },
    });
    logger.info({ meetingId: meeting.id, mediaId: media.id, durationSeconds }, "recording imported");
    return;
  }
  if (status === "ABORTED" && meeting.status === "live") {
    // Typical cause: nobody published audio yet ("Start signal not received"). Allow a retry on next join.
    const [m] = await db.update(meetings).set({ recordingStatus: "none", recordingEgressId: null, recordingError: info.error || "aborted (no audio yet)" }).where(eq(meetings.id, meeting.id)).returning();
    await broadcast(m);
    return;
  }
  await fail(meeting, info.error || status.toLowerCase());
}

async function fail(meeting: Meeting, error: string) {
  const [m] = await db.update(meetings).set({ recordingStatus: "failed", recordingError: error.slice(0, 500) }).where(eq(meetings.id, meeting.id)).returning();
  await broadcast(m);
  logger.warn({ meetingId: meeting.id, error }, "recording failed");
}
