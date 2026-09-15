import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLog, meetingInvites, meetingSpaces, meetings, users, type MeetingInvite, type User } from "@/server/db/schema";
import { env } from "@/server/env";

/**
 * Meeting invite link (one per meeting, admins only, off by default).
 *
 * The link is a random token; the public page /invite/<token> lets people register and activates the
 * account right away (the admin vouches by switching the link on). The account remembers the link it
 * came through (users.invitedViaId = the meeting) and is taken to the meeting page once after signing in.
 */

export type ResolvedInvite = {
  invite: MeetingInvite;
  meeting: { id: string; title: string; description: string | null; startsAt: Date | null; kind: string; status: string; coverMediaId: string | null };
  space: { id: string; name: string; slug: string };
  /** app-relative meeting page */
  href: string;
};

export function inviteUrl(token: string): string {
  return `${env.APP_URL}/invite/${token}`;
}

export function meetingHref(spaceSlug: string, meetingId: string): string {
  return `/meetings/${spaceSlug}/${meetingId}`;
}

export type InviteWithUrl = MeetingInvite & { url: string };

export async function getMeetingInvite(meetingId: string): Promise<InviteWithUrl | undefined> {
  const row = await db.query.meetingInvites.findFirst({ where: eq(meetingInvites.meetingId, meetingId) });
  return row ? { ...row, url: inviteUrl(row.token) } : undefined;
}

/**
 * Switches the meeting's link on or off; the row (and thus the URL) is created on first use and the
 * token stays stable across toggles, so a link sent out earlier works again after re-enabling.
 */
export async function setInviteEnabled(meetingId: string, enabled: boolean, actorId: string): Promise<InviteWithUrl> {
  const existing = await db.query.meetingInvites.findFirst({ where: eq(meetingInvites.meetingId, meetingId) });
  let row: MeetingInvite;
  if (existing) {
    [row] = await db.update(meetingInvites).set({ enabled }).where(eq(meetingInvites.id, existing.id)).returning();
  } else {
    [row] = await db
      .insert(meetingInvites)
      .values({ meetingId, token: randomBytes(24).toString("base64url"), enabled, createdBy: actorId })
      .returning();
  }
  if (!existing || existing.enabled !== enabled) {
    await db.insert(auditLog).values({ actorId, action: enabled ? "meeting.invite.enabled" : "meeting.invite.disabled", targetType: "meeting_invite", targetId: row.id, details: { meetingId } });
  }
  return { ...row, url: inviteUrl(row.token) };
}

/** Returns the invite with its meeting when the token is valid: enabled, meeting not deleted. */
export async function resolveInvite(token: string): Promise<ResolvedInvite | null> {
  if (!token || token.length > 64) return null;
  const [row] = await db
    .select({
      invite: meetingInvites,
      meeting: { id: meetings.id, title: meetings.title, description: meetings.description, startsAt: meetings.startsAt, kind: meetings.kind, status: meetings.status, coverMediaId: meetings.coverMediaId, deletedAt: meetings.deletedAt },
      space: { id: meetingSpaces.id, name: meetingSpaces.name, slug: meetingSpaces.slug },
    })
    .from(meetingInvites)
    .innerJoin(meetings, eq(meetings.id, meetingInvites.meetingId))
    .innerJoin(meetingSpaces, eq(meetingSpaces.id, meetings.spaceId))
    .where(eq(meetingInvites.token, token))
    .limit(1);
  if (!row || !row.invite.enabled || row.meeting.deletedAt) return null;
  const { deletedAt: _deleted, ...meeting } = row.meeting;
  void _deleted;
  return { invite: row.invite, meeting, space: row.space, href: meetingHref(row.space.slug, row.meeting.id) };
}

/** Counts one more account created through the link. */
export async function countInviteUse(id: string): Promise<void> {
  await db
    .update(meetingInvites)
    .set({ useCount: sql`${meetingInvites.useCount} + 1` })
    .where(eq(meetingInvites.id, id));
}

/**
 * Where a freshly invited member should land after signing in, or null once that happened
 * (or when the meeting is gone). Callers mark the redirect done with `markInviteLanded`.
 */
export async function pendingInviteRedirect(user: Pick<User, "invitedViaId" | "inviteLandedAt">): Promise<string | null> {
  if (!user.invitedViaId || user.inviteLandedAt) return null;
  const [row] = await db
    .select({ meetingId: meetings.id, slug: meetingSpaces.slug, deletedAt: meetings.deletedAt })
    .from(meetingInvites)
    .innerJoin(meetings, eq(meetings.id, meetingInvites.meetingId))
    .innerJoin(meetingSpaces, eq(meetingSpaces.id, meetings.spaceId))
    .where(eq(meetingInvites.id, user.invitedViaId))
    .limit(1);
  if (!row || row.deletedAt) return null;
  return meetingHref(row.slug, row.meetingId);
}

export async function markInviteLanded(userId: string): Promise<void> {
  await db.update(users).set({ inviteLandedAt: new Date() }).where(and(eq(users.id, userId), isNull(users.inviteLandedAt)));
}

export type InviteSource = { inviteId: string; meetingId: string; meetingTitle: string; href: string };

/** Which meeting each of the given users was invited to (for the member list). */
export async function inviteSourcesForUsers(userIds: string[]): Promise<Map<string, InviteSource>> {
  const out = new Map<string, InviteSource>();
  if (userIds.length === 0) return out;
  const rows = await db
    .select({ userId: users.id, inviteId: meetingInvites.id, meetingId: meetings.id, meetingTitle: meetings.title, slug: meetingSpaces.slug })
    .from(users)
    .innerJoin(meetingInvites, eq(meetingInvites.id, users.invitedViaId))
    .innerJoin(meetings, eq(meetings.id, meetingInvites.meetingId))
    .innerJoin(meetingSpaces, eq(meetingSpaces.id, meetings.spaceId))
    .where(inArray(users.id, userIds));
  for (const r of rows) out.set(r.userId, { inviteId: r.inviteId, meetingId: r.meetingId, meetingTitle: r.meetingTitle, href: meetingHref(r.slug, r.meetingId) });
  return out;
}
