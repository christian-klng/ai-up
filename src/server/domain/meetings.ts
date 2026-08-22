import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  auditLog,
  mediaFiles,
  meetingParticipants,
  meetingProtocolVersions,
  meetingSpaces,
  meetings,
  users,
  type MediaFile,
  type Meeting,
  type MeetingKind,
  type MeetingProtocolVersion,
  type MeetingSpace,
} from "@/server/db/schema";
import { emitDomainEvent, type EventOrigin, type MeetingEventMeeting } from "@/server/events/bus";
import { slugify } from "@/lib/slug";

// ---------------------------------------------------------------------------
// Meeting spaces
// ---------------------------------------------------------------------------

export type SpaceWithStats = MeetingSpace & { meetingCount: number; liveCount: number };

export async function listSpaces(): Promise<SpaceWithStats[]> {
  const rows = await db
    .select({
      space: meetingSpaces,
      meetingCount: sql<number>`(select count(*)::int from ${meetings} m where m.space_id = ${meetingSpaces}."id" and m.deleted_at is null)`,
      liveCount: sql<number>`(select count(*)::int from ${meetings} m where m.space_id = ${meetingSpaces}."id" and m.deleted_at is null and m.status = 'live')`,
    })
    .from(meetingSpaces)
    .orderBy(asc(meetingSpaces.sortOrder), asc(meetingSpaces.name));
  return rows.map((r) => ({ ...r.space, meetingCount: r.meetingCount, liveCount: r.liveCount }));
}

export async function getSpaceBySlug(slug: string): Promise<MeetingSpace | undefined> {
  return db.query.meetingSpaces.findFirst({ where: eq(meetingSpaces.slug, slug) });
}
export async function getSpaceById(id: string): Promise<MeetingSpace | undefined> {
  return db.query.meetingSpaces.findFirst({ where: eq(meetingSpaces.id, id) });
}

async function uniqueSlug(base: string, excludeId?: string): Promise<string> {
  let slug = slugify(base);
  for (let i = 2; i < 100; i++) {
    const clash = await db.query.meetingSpaces.findFirst({ where: excludeId ? and(eq(meetingSpaces.slug, slug), ne(meetingSpaces.id, excludeId)) : eq(meetingSpaces.slug, slug), columns: { id: true } });
    if (!clash) return slug;
    slug = `${slugify(base)}-${i}`;
  }
  return `${slugify(base)}-${Date.now().toString(36)}`;
}

export type SpaceInput = { name: string; purpose: string; description?: string | null; icon?: string; recordingDefault?: boolean };

export async function createSpace(input: SpaceInput, actorId: string): Promise<MeetingSpace> {
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${meetingSpaces.sortOrder}), -1)::int` }).from(meetingSpaces);
  const [row] = await db
    .insert(meetingSpaces)
    .values({ name: input.name.trim(), slug: await uniqueSlug(input.name), purpose: input.purpose.trim(), description: input.description?.trim() || null, icon: input.icon ?? "calendar", recordingDefault: input.recordingDefault ?? true, sortOrder: max + 1, createdBy: actorId })
    .returning();
  await db.insert(auditLog).values({ actorId, action: "meeting_space.created", targetType: "meeting_space", targetId: row.id, details: { name: row.name } });
  return row;
}

export async function updateSpace(id: string, input: SpaceInput, actorId: string): Promise<MeetingSpace | undefined> {
  const existing = await getSpaceById(id);
  if (!existing) return undefined;
  const [row] = await db
    .update(meetingSpaces)
    .set({ name: input.name.trim(), slug: existing.name.trim() === input.name.trim() ? existing.slug : await uniqueSlug(input.name, id), purpose: input.purpose.trim(), description: input.description?.trim() || null, icon: input.icon ?? existing.icon, recordingDefault: input.recordingDefault ?? existing.recordingDefault })
    .where(eq(meetingSpaces.id, id))
    .returning();
  await db.insert(auditLog).values({ actorId, action: "meeting_space.updated", targetType: "meeting_space", targetId: id, details: { name: row.name } });
  return row;
}

export async function deleteSpace(id: string, actorId: string): Promise<boolean> {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(meetings).where(and(eq(meetings.spaceId, id), isNull(meetings.deletedAt)));
  if (count > 0) return false;
  await db.delete(meetingSpaces).where(eq(meetingSpaces.id, id));
  await db.insert(auditLog).values({ actorId, action: "meeting_space.deleted", targetType: "meeting_space", targetId: id });
  return true;
}

export async function moveSpace(id: string, direction: "up" | "down"): Promise<void> {
  const all = await db.query.meetingSpaces.findMany({ orderBy: [asc(meetingSpaces.sortOrder), asc(meetingSpaces.name)] });
  const idx = all.findIndex((a) => a.id === id);
  const swap = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swap < 0 || swap >= all.length) return;
  const reordered = [...all];
  [reordered[idx], reordered[swap]] = [reordered[swap], reordered[idx]];
  await db.transaction(async (tx) => {
    for (let i = 0; i < reordered.length; i++) if (reordered[i].sortOrder !== i) await tx.update(meetingSpaces).set({ sortOrder: i }).where(eq(meetingSpaces.id, reordered[i].id));
  });
}

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------

export type MeetingListItem = Meeting & { host: { id: string; name: string; avatarMediaId: string | null } | null; recording: MediaFile | null; spaceSlug: string; spaceName: string };

export type MeetingInput = { title: string; description?: string | null; kind: MeetingKind; startsAt?: Date | null; recordingEnabled?: boolean };

async function eventMeeting(m: Meeting): Promise<MeetingEventMeeting> {
  const space = await getSpaceById(m.spaceId);
  return { id: m.id, title: m.title, kind: m.kind, status: m.status, spaceId: m.spaceId, spaceSlug: space?.slug ?? "", spaceName: space?.name ?? "", hostId: m.hostId, href: `/meetings/${space?.slug ?? m.spaceId}/${m.id}` };
}

export async function createMeeting(spaceId: string, input: MeetingInput, actorId: string, origin: EventOrigin = { kind: "user" }): Promise<Meeting> {
  const [row] = await db
    .insert(meetings)
    .values({
      spaceId,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      kind: input.kind,
      status: "scheduled",
      startsAt: input.startsAt ?? null,
      hostId: actorId,
      createdBy: actorId,
      recordingEnabled: input.kind === "protocol" ? false : (input.recordingEnabled ?? true),
    })
    .returning();
  // room name = meeting id (stable, unique, no secrets)
  const [withRoom] = await db.update(meetings).set({ roomName: `m-${row.id}` }).where(eq(meetings.id, row.id)).returning();
  emitDomainEvent("meeting.created", { meeting: await eventMeeting(withRoom), actorId, origin });
  return withRoom;
}

export async function updateMeeting(id: string, input: Partial<MeetingInput>, actorId: string): Promise<Meeting | undefined> {
  const patch: Partial<typeof meetings.$inferInsert> = {};
  if (input.title !== undefined) patch.title = input.title.trim();
  if (input.description !== undefined) patch.description = input.description?.trim() || null;
  if (input.startsAt !== undefined) patch.startsAt = input.startsAt;
  if (input.recordingEnabled !== undefined) patch.recordingEnabled = input.recordingEnabled;
  if (input.kind !== undefined) patch.kind = input.kind;
  const [row] = await db.update(meetings).set(patch).where(and(eq(meetings.id, id), isNull(meetings.deletedAt))).returning();
  if (row) await db.insert(auditLog).values({ actorId, action: "meeting.updated", targetType: "meeting", targetId: id });
  return row;
}

export async function softDeleteMeeting(id: string, actorId: string): Promise<Meeting | undefined> {
  const [row] = await db.update(meetings).set({ deletedAt: new Date() }).where(and(eq(meetings.id, id), isNull(meetings.deletedAt))).returning();
  if (row) await db.insert(auditLog).values({ actorId, action: "meeting.deleted", targetType: "meeting", targetId: id });
  return row;
}

export async function getMeeting(id: string): Promise<MeetingListItem | undefined> {
  const rows = await db
    .select({ m: meetings, host: { id: users.id, name: users.name, avatarMediaId: users.avatarMediaId }, recording: mediaFiles, spaceSlug: meetingSpaces.slug, spaceName: meetingSpaces.name })
    .from(meetings)
    .innerJoin(meetingSpaces, eq(meetingSpaces.id, meetings.spaceId))
    .leftJoin(users, eq(users.id, meetings.hostId))
    .leftJoin(mediaFiles, eq(mediaFiles.id, meetings.recordingMediaId))
    .where(and(eq(meetings.id, id), isNull(meetings.deletedAt)))
    .limit(1);
  const r = rows[0];
  if (!r) return undefined;
  return { ...r.m, host: r.host?.id ? r.host : null, recording: r.recording, spaceSlug: r.spaceSlug, spaceName: r.spaceName };
}

export async function getMeetingByRoom(roomName: string): Promise<Meeting | undefined> {
  return db.query.meetings.findFirst({ where: and(eq(meetings.roomName, roomName), isNull(meetings.deletedAt)) });
}

export async function listMeetings(opts: { spaceId?: string; status?: Meeting["status"]; limit?: number } = {}): Promise<MeetingListItem[]> {
  const conds = [isNull(meetings.deletedAt)];
  if (opts.spaceId) conds.push(eq(meetings.spaceId, opts.spaceId));
  if (opts.status) conds.push(eq(meetings.status, opts.status));
  const rows = await db
    .select({ m: meetings, host: { id: users.id, name: users.name, avatarMediaId: users.avatarMediaId }, recording: mediaFiles, spaceSlug: meetingSpaces.slug, spaceName: meetingSpaces.name })
    .from(meetings)
    .innerJoin(meetingSpaces, eq(meetingSpaces.id, meetings.spaceId))
    .leftJoin(users, eq(users.id, meetings.hostId))
    .leftJoin(mediaFiles, eq(mediaFiles.id, meetings.recordingMediaId))
    .where(and(...conds))
    // live first, then upcoming soonest first, then past newest first
    .orderBy(sql`case ${meetings.status} when 'live' then 0 when 'scheduled' then 1 else 2 end`, sql`case when ${meetings.status} = 'ended' then null else coalesce(${meetings.startsAt}, ${meetings.createdAt}) end asc nulls last`, desc(sql`coalesce(${meetings.endedAt}, ${meetings.startsAt}, ${meetings.createdAt})`))
    .limit(opts.limit ?? 100);
  return rows.map((r) => ({ ...r.m, host: r.host?.id ? r.host : null, recording: r.recording, spaceSlug: r.spaceSlug, spaceName: r.spaceName }));
}

/** Live meetings grouped by space (for the sidebar's blinking dot). */
export async function liveSpaceIds(): Promise<Set<string>> {
  const rows = await db.select({ spaceId: meetings.spaceId }).from(meetings).where(and(eq(meetings.status, "live"), isNull(meetings.deletedAt)));
  return new Set(rows.map((r) => r.spaceId));
}

// ---------------------------------------------------------------------------
// Protocol (markdown, versioned)
// ---------------------------------------------------------------------------

export async function saveProtocol(meetingId: string, body: string, changeNote: string | null, actorId: string): Promise<Meeting | undefined> {
  const existing = await db.query.meetings.findFirst({ where: and(eq(meetings.id, meetingId), isNull(meetings.deletedAt)) });
  if (!existing) return undefined;
  if ((existing.protocolMarkdown ?? "") === body) return existing;
  const nextNo = existing.protocolVersion + 1;
  return db.transaction(async (tx) => {
    await tx.insert(meetingProtocolVersions).values({ meetingId, versionNo: nextNo, body, changeNote, createdBy: actorId });
    const [row] = await tx.update(meetings).set({ protocolMarkdown: body, protocolVersion: nextNo }).where(eq(meetings.id, meetingId)).returning();
    return row;
  });
}

export type ProtocolVersionWithUser = MeetingProtocolVersion & { createdByUser: { id: string; name: string; avatarMediaId: string | null } | null };

export async function listProtocolVersions(meetingId: string): Promise<ProtocolVersionWithUser[]> {
  const rows = await db
    .select({ v: meetingProtocolVersions, user: { id: users.id, name: users.name, avatarMediaId: users.avatarMediaId } })
    .from(meetingProtocolVersions)
    .leftJoin(users, eq(users.id, meetingProtocolVersions.createdBy))
    .where(eq(meetingProtocolVersions.meetingId, meetingId))
    .orderBy(desc(meetingProtocolVersions.versionNo));
  return rows.map((r) => ({ ...r.v, createdByUser: r.user?.id ? r.user : null }));
}

export async function restoreProtocolVersion(meetingId: string, versionId: string, actorId: string, note: string): Promise<Meeting | undefined> {
  const v = await db.query.meetingProtocolVersions.findFirst({ where: and(eq(meetingProtocolVersions.id, versionId), eq(meetingProtocolVersions.meetingId, meetingId)) });
  if (!v) return undefined;
  return saveProtocol(meetingId, v.body, note, actorId);
}

// ---------------------------------------------------------------------------
// Participants (webhooks fill these in 4d)
// ---------------------------------------------------------------------------

export async function listParticipants(meetingId: string) {
  const rows = await db
    .select({ p: meetingParticipants, user: { id: users.id, name: users.name, avatarMediaId: users.avatarMediaId } })
    .from(meetingParticipants)
    .leftJoin(users, eq(users.id, meetingParticipants.userId))
    .where(eq(meetingParticipants.meetingId, meetingId))
    .orderBy(asc(meetingParticipants.joinedAt));
  return rows.map((r) => ({ ...r.p, user: r.user?.id ? r.user : null }));
}

export function canEditMeeting(user: { id: string; role: string }, meeting: { hostId: string | null; createdBy: string | null }): boolean {
  return user.role === "admin" || meeting.hostId === user.id || meeting.createdBy === user.id;
}

/** Space names for a set of ids (used for breadcrumbs/sidebar). */
export async function spaceNames(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await db.select({ id: meetingSpaces.id, name: meetingSpaces.name }).from(meetingSpaces).where(inArray(meetingSpaces.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}
