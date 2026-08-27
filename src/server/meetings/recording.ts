import path from "node:path";
import os from "node:os";
import { access, unlink } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { EgressClient, EncodedFileOutput, EncodedFileType, S3Upload, type WebhookEvent } from "livekit-server-sdk";
import { db } from "@/server/db/client";
import { meetingRecordings, meetings, type Meeting } from "@/server/db/schema";
import { getLiveKitConfig, livekitHttpUrl, livekitS3, type LiveKitS3 } from "@/server/domain/integrations";
import { getSpaceById } from "@/server/domain/meetings";
import { emitDomainEvent } from "@/server/events/bus";
import { publishBroadcast } from "@/server/realtime/publish";
import { storeFileFromPath } from "@/server/media/storage";
import { logger } from "@/server/logger";

/**
 * Audio-only recording of meetings via LiveKit Room Composite Egress.
 *  - started automatically when the first participant joins (if the meeting has recording enabled)
 *    or manually by the host; stopped when the room ends or by the host
 *  - with S3 configured (app and media server on separate hosts): egress uploads to the bucket, the app
 *    downloads the object on `egress_ended`. Credentials travel with the egress request, so the media
 *    server stores none of its own.
 *  - without S3 (single host, local development): egress writes `/out/<room>/<file>.ogg`, which is the
 *    shared `<recordingsPath>/<room>/<file>.ogg` the app reads directly.
 *  - either way the source is removed once the file is in media_files, so it is not kept twice.
 */
const EGRESS_STATUS = ["STARTING", "ACTIVE", "ENDING", "COMPLETE", "FAILED", "ABORTED", "LIMIT_REACHED"] as const;

type LiveKitCfg = NonNullable<Awaited<ReturnType<typeof getLiveKitConfig>>>;

async function egressContext(): Promise<{ client: EgressClient; cfg: LiveKitCfg } | null> {
  const cfg = await getLiveKitConfig();
  if (!cfg || !cfg.enabled) return null;
  return { client: new EgressClient(livekitHttpUrl(cfg.url), cfg.apiKey, cfg.apiSecret), cfg };
}

/** Path-style addressing keeps one stable endpoint host instead of a per-bucket subdomain. */
function s3Upload(s3: LiveKitS3): S3Upload {
  return new S3Upload({ accessKey: s3.accessKey, secret: s3.secretKey, region: s3.region, endpoint: s3.endpoint, bucket: s3.bucket, forcePathStyle: true });
}

async function s3Client(s3: LiveKitS3) {
  const { S3Client } = await import("@aws-sdk/client-s3");
  return new S3Client({ endpoint: s3.endpoint, region: s3.region, credentials: { accessKeyId: s3.accessKey, secretAccessKey: s3.secretKey }, forcePathStyle: true });
}

/** Egress echoes the requested filepath back as the object key. */
function s3Key(filename: string): string {
  return filename.replace(/^\/+/, "");
}

/** Downloads the finished recording to a temp file; the caller removes it after the import. */
async function downloadFromS3(s3: LiveKitS3, key: string): Promise<string> {
  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const { createWriteStream } = await import("node:fs");
  const { pipeline } = await import("node:stream/promises");
  const client = await s3Client(s3);
  const res = await client.send(new GetObjectCommand({ Bucket: s3.bucket, Key: key }));
  if (!res.Body) throw new Error(`no body for ${key}`);
  const target = path.join(os.tmpdir(), `aiup-recording-${crypto.randomUUID()}.ogg`);
  await pipeline(res.Body as NodeJS.ReadableStream, createWriteStream(target));
  return target;
}

/** Removes the egress source after a successful import – best effort, never fails the import. */
async function removeSource(s3: LiveKitS3 | null, key: string, localPath: string): Promise<void> {
  try {
    if (s3) {
      const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
      const client = await s3Client(s3);
      await client.send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: key }));
    } else {
      await unlink(localPath);
    }
  } catch (err) {
    logger.warn({ key, err: (err as Error).message }, "could not remove recording source");
  }
}

async function broadcast(m: Meeting) {
  const space = await getSpaceById(m.spaceId);
  await publishBroadcast("meeting.updated", { meetingId: m.id, spaceId: m.spaceId, spaceSlug: space?.slug ?? "", status: m.status, participantCount: m.participantCount, recordingStatus: m.recordingStatus });
}

export async function startRecording(meeting: Meeting, opts: { manual?: boolean } = {}): Promise<{ ok: true; egressId: string } | { ok: false; error: string }> {
  const ctx = await egressContext();
  if (!ctx || !meeting.roomName) return { ok: false, error: "not configured" };
  if (meeting.recordingStatus === "recording") return { ok: true, egressId: meeting.recordingEgressId ?? "" };
  const s3 = livekitS3(ctx.cfg);
  // S3: the filepath is the object key. Local: a path inside the egress container, where /out is the mount.
  const filepath = `${s3 ? "" : "/out/"}${meeting.roomName}/${meeting.id}-{time}.ogg`;
  const fileOutput = s3
    ? new EncodedFileOutput({ fileType: EncodedFileType.OGG, filepath, output: { case: "s3", value: s3Upload(s3) } })
    : new EncodedFileOutput({ fileType: EncodedFileType.OGG, filepath });
  try {
    const info = await ctx.client.startRoomCompositeEgress(meeting.roomName, { file: fileOutput }, { audioOnly: true });
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
  const ctx = await egressContext();
  if (!ctx) return;
  try {
    await ctx.client.stopEgress(meeting.recordingEgressId);
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
    const s3 = livekitS3(cfg);
    const key = s3Key(file.filename);
    const localSource = localRecordingPath(cfg.recordingsPath, file.filename);
    let source: string;
    try {
      if (s3) {
        source = await downloadFromS3(s3, key);
      } else {
        await access(localSource);
        source = localSource;
      }
    } catch (err) {
      const why = s3 ? `not readable from ${s3.bucket}/${key}: ${(err as Error).message}` : `file not found at ${localSource} – is the recordings directory mounted in the app?`;
      await fail(meeting, `recording ${why}`);
      return;
    }
    const durationSeconds = file.duration ? Math.round(Number(file.duration) / 1e9) : null;
    let media: Awaited<ReturnType<typeof storeFileFromPath>>;
    try {
      media = await storeFileFromPath({ sourcePath: source, mime: "audio/ogg", originalName: `${meeting.title.replace(/[^\w\-äöüÄÖÜß ]+/g, "").trim() || "meeting"}.ogg`, purpose: "recording", uploadedBy: meeting.hostId, durationSeconds });
    } catch (err) {
      await fail(meeting, `recording import failed: ${(err as Error).message}`);
      return;
    } finally {
      if (s3) await unlink(source).catch(() => undefined); // temporary copy of the object
    }
    // The file is in the media store now, so the egress source can go (PLAN.md phase 7).
    await removeSource(s3, key, localSource);
    await db.insert(meetingRecordings).values({ meetingId: meeting.id, mediaId: media.id });
    // If the meeting was reopened while this egress was still finishing, its recording slot is already
    // reset to "none" – keep it that way so the new session's auto-start is not blocked. The row above
    // and the latest-pointer still record the finished file either way.
    const fresh = await db.query.meetings.findFirst({ where: eq(meetings.id, meeting.id), columns: { recordingStatus: true } });
    const slotActive = fresh?.recordingStatus === "processing" || fresh?.recordingStatus === "recording";
    const [m] = await db
      .update(meetings)
      .set({ recordingMediaId: media.id, ...(slotActive ? { recordingStatus: "available" as const, recordingError: null } : {}) })
      .where(eq(meetings.id, meeting.id))
      .returning();
    await broadcast(m);
    const space = await getSpaceById(m.spaceId);
    emitDomainEvent("meeting.recording.available", {
      meeting: { id: m.id, title: m.title, kind: m.kind, status: m.status, spaceId: m.spaceId, spaceSlug: space?.slug ?? "", spaceName: space?.name ?? "", hostId: m.hostId, href: `/meetings/${space?.slug ?? m.spaceId}/${m.id}` },
      mediaId: media.id,
      recordingUrl: `/api/files/${media.id}`,
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
