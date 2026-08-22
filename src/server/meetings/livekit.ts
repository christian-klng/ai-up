import { and, eq, isNull, sql } from "drizzle-orm";
import { AccessToken, RoomServiceClient, WebhookReceiver, type WebhookEvent } from "livekit-server-sdk";
import { ParticipantInfo_Kind } from "@livekit/protocol";
import { db } from "@/server/db/client";
import { meetingParticipants, meetings, users, type Meeting } from "@/server/db/schema";
import { getLiveKitConfig, livekitHttpUrl } from "@/server/domain/integrations";
import { getMeetingByRoom, getSpaceById } from "@/server/domain/meetings";
import { emitDomainEvent } from "@/server/events/bus";
import { publishBroadcast } from "@/server/realtime/publish";
import { logger } from "@/server/logger";

/**
 * LiveKit glue for meetings: access tokens, room control and webhook processing.
 * Room name convention: `m-<meetingId>` (set at meeting creation).
 */
export class LiveKitNotConfiguredError extends Error {
  constructor() {
    super("LiveKit is not configured or disabled");
    this.name = "LiveKitNotConfiguredError";
  }
}

export async function requireLiveKit() {
  const cfg = await getLiveKitConfig();
  if (!cfg || !cfg.enabled) throw new LiveKitNotConfiguredError();
  return cfg;
}

export async function roomService(): Promise<RoomServiceClient> {
  const cfg = await requireLiveKit();
  return new RoomServiceClient(livekitHttpUrl(cfg.url), cfg.apiKey, cfg.apiSecret);
}

/** Access token for a member joining a meeting room. Hosts/admins get room-admin rights. */
export async function createMeetingToken(meeting: Meeting, user: { id: string; name: string; avatarMediaId: string | null; role: string }, isHost: boolean): Promise<{ token: string; url: string; roomName: string }> {
  const cfg = await requireLiveKit();
  const roomName = meeting.roomName ?? `m-${meeting.id}`;
  const at = new AccessToken(cfg.apiKey, cfg.apiSecret, {
    identity: user.id,
    name: user.name,
    ttl: "2h",
    metadata: JSON.stringify({ userId: user.id, avatarMediaId: user.avatarMediaId, role: user.role }),
  });
  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    roomAdmin: isHost,
    roomRecord: isHost,
  });
  return { token: await at.toJwt(), url: cfg.url, roomName };
}

/** Ends the LiveKit room (disconnects everyone); the webhook `room_finished` marks the meeting ended. */
export async function endRoom(meeting: Meeting): Promise<void> {
  if (!meeting.roomName) return;
  try {
    const svc = await roomService();
    await svc.deleteRoom(meeting.roomName);
  } catch (err) {
    // Room may not exist (never started) – that's fine
    logger.info({ err: (err as Error).message, room: meeting.roomName }, "endRoom: deleteRoom failed/ignored");
  }
}

export async function listRoomParticipants(meeting: Meeting): Promise<{ identity: string; name: string }[]> {
  if (!meeting.roomName) return [];
  try {
    const svc = await roomService();
    const ps = await svc.listParticipants(meeting.roomName);
    return ps.map((p) => ({ identity: p.identity, name: p.name }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export async function verifyWebhook(body: string, authHeader: string | null): Promise<WebhookEvent> {
  const cfg = await getLiveKitConfig();
  if (!cfg) throw new LiveKitNotConfiguredError();
  const receiver = new WebhookReceiver(cfg.apiKey, cfg.apiSecret);
  return receiver.receive(body, authHeader ?? undefined);
}

async function broadcastMeeting(m: Meeting) {
  const space = await getSpaceById(m.spaceId);
  await publishBroadcast("meeting.updated", { meetingId: m.id, spaceId: m.spaceId, spaceSlug: space?.slug ?? "", status: m.status, participantCount: m.participantCount, recordingStatus: m.recordingStatus });
}

async function eventPayload(m: Meeting) {
  const space = await getSpaceById(m.spaceId);
  return { id: m.id, title: m.title, kind: m.kind, status: m.status, spaceId: m.spaceId, spaceSlug: space?.slug ?? "", spaceName: space?.name ?? "", hostId: m.hostId, href: `/meetings/${space?.slug ?? m.spaceId}/${m.id}` };
}

/** Applies a LiveKit webhook event to our meeting state. Idempotent where possible. */
export async function handleWebhookEvent(ev: WebhookEvent): Promise<void> {
  const roomName = ev.room?.name ?? ev.egressInfo?.roomName;
  if (!roomName) return;
  const meeting = await getMeetingByRoom(roomName);
  if (!meeting) {
    logger.debug({ event: ev.event, roomName }, "webhook for unknown room");
    return;
  }
  switch (ev.event) {
    case "room_started": {
      if (meeting.status !== "live") {
        const [m] = await db.update(meetings).set({ status: "live", startedAt: meeting.startedAt ?? new Date(), endedAt: null, participantCount: 0 }).where(eq(meetings.id, meeting.id)).returning();
        emitDomainEvent("meeting.started", { meeting: await eventPayload(m), actorId: null, origin: { kind: "system" } });
        await broadcastMeeting(m);
      }
      break;
    }
    case "participant_joined": {
      const p = ev.participant;
      // Egress/ingress/agents join as hidden participants – they are not attendees
      if (!p || p.kind !== ParticipantInfo_Kind.STANDARD) break;
      const userRow = await db.query.users.findFirst({ where: eq(users.id, p.identity), columns: { id: true } });
      await db.insert(meetingParticipants).values({ meetingId: meeting.id, userId: userRow?.id ?? null, identity: p.identity, displayName: p.name || null });
      const [m] = await db
        .update(meetings)
        .set({ status: "live", startedAt: meeting.startedAt ?? new Date(), endedAt: null, participantCount: sql`(select count(*)::int from ${meetingParticipants} mp where mp.meeting_id = ${meeting.id} and mp.left_at is null)` })
        .where(eq(meetings.id, meeting.id))
        .returning();
      if (meeting.status !== "live") emitDomainEvent("meeting.started", { meeting: await eventPayload(m), actorId: null, origin: { kind: "system" } });
      await broadcastMeeting(m);
      if (m.recordingEnabled && (m.recordingStatus === "none" || m.recordingStatus === "failed")) {
        const { startRecording } = await import("./recording");
        await startRecording(m);
      }
      break;
    }
    case "participant_left": {
      const p = ev.participant;
      if (!p || p.kind !== ParticipantInfo_Kind.STANDARD) break;
      await db
        .update(meetingParticipants)
        .set({ leftAt: new Date() })
        .where(and(eq(meetingParticipants.meetingId, meeting.id), eq(meetingParticipants.identity, p.identity), isNull(meetingParticipants.leftAt)));
      const [m] = await db
        .update(meetings)
        .set({ participantCount: sql`(select count(*)::int from ${meetingParticipants} mp where mp.meeting_id = ${meeting.id} and mp.left_at is null)` })
        .where(eq(meetings.id, meeting.id))
        .returning();
      await broadcastMeeting(m);
      break;
    }
    case "room_finished": {
      {
        const { stopRecording } = await import("./recording");
        await stopRecording(meeting);
      }
      await db.update(meetingParticipants).set({ leftAt: new Date() }).where(and(eq(meetingParticipants.meetingId, meeting.id), isNull(meetingParticipants.leftAt)));
      const [m] = await db.update(meetings).set({ status: "ended", endedAt: new Date(), participantCount: 0 }).where(eq(meetings.id, meeting.id)).returning();
      emitDomainEvent("meeting.ended", { meeting: await eventPayload(m), actorId: null, origin: { kind: "system" } });
      await broadcastMeeting(m);
      break;
    }
    case "egress_started":
    case "egress_updated":
    case "egress_ended": {
      // Recording lifecycle – handled in src/server/meetings/recording.ts (phase 4e)
      const { handleEgressEvent } = await import("./recording");
      await handleEgressEvent(meeting, ev);
      break;
    }
    default:
      break;
  }
}

/** Marks a meeting ended locally (used by "end meeting" for instant feedback; webhook confirms). */
export async function markMeetingEnded(meetingId: string): Promise<Meeting | undefined> {
  const current = await db.query.meetings.findFirst({ where: eq(meetings.id, meetingId) });
  if (current) {
    const { stopRecording } = await import("./recording");
    await stopRecording(current);
  }
  await db.update(meetingParticipants).set({ leftAt: new Date() }).where(and(eq(meetingParticipants.meetingId, meetingId), isNull(meetingParticipants.leftAt)));
  const [m] = await db.update(meetings).set({ status: "ended", endedAt: new Date(), participantCount: 0 }).where(eq(meetings.id, meetingId)).returning();
  if (m) {
    emitDomainEvent("meeting.ended", { meeting: await eventPayload(m), actorId: null, origin: { kind: "user" } });
    await broadcastMeeting(m);
  }
  return m;
}

export async function reopenMeeting(meetingId: string): Promise<Meeting | undefined> {
  const [m] = await db.update(meetings).set({ status: "scheduled", endedAt: null, participantCount: 0 }).where(eq(meetings.id, meetingId)).returning();
  if (m) await broadcastMeeting(m);
  return m;
}
