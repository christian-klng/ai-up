import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLog, meetingInvites, meetingSpaces, meetings, users, type MeetingInvite, type User } from "@/server/db/schema";
import { env } from "@/server/env";

/**
 * Meeting invite links (admins only).
 *
 * A link is a random token; the public page /invite/<token> lets people register and activates the
 * account right away (the admin vouches by handing out the link). The account remembers the link it
 * came through (users.invitedViaId) and is taken to the meeting page once after signing in.
 */

export const INVITE_LABEL_MAX = 80;

export type ResolvedInvite = {
  invite: MeetingInvite;
  meeting: { id: string; title: string; startsAt: Date | null; kind: string; status: string };
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

export async function createInvite(meetingId: string, label: string, actorId: string): Promise<MeetingInvite> {
  const token = randomBytes(24).toString("base64url");
  const [row] = await db
    .insert(meetingInvites)
    .values({ meetingId, token, label: label.trim().slice(0, INVITE_LABEL_MAX) || "Link", createdBy: actorId })
    .returning();
  await db.insert(auditLog).values({ actorId, action: "meeting.invite.created", targetType: "meeting_invite", targetId: row.id, details: { meetingId, label: row.label } });
  return row;
}

export async function revokeInvite(id: string, actorId: string): Promise<MeetingInvite | undefined> {
  const [row] = await db
    .update(meetingInvites)
    .set({ revokedAt: new Date() })
    .where(and(eq(meetingInvites.id, id), isNull(meetingInvites.revokedAt)))
    .returning();
  if (row) await db.insert(auditLog).values({ actorId, action: "meeting.invite.revoked", targetType: "meeting_invite", targetId: id, details: { meetingId: row.meetingId } });
  return row;
}

export async function getInvite(id: string): Promise<MeetingInvite | undefined> {
  return db.query.meetingInvites.findFirst({ where: eq(meetingInvites.id, id) });
}

export type InviteListItem = MeetingInvite & { url: string; creator: { id: string; name: string } | null };

/** All links of a meeting, newest first, revoked ones included (they keep their statistics). */
export async function listInvites(meetingId: string): Promise<InviteListItem[]> {
  const rows = await db.query.meetingInvites.findMany({
    where: eq(meetingInvites.meetingId, meetingId),
    orderBy: [desc(meetingInvites.createdAt)],
    with: { creator: { columns: { id: true, name: true } } },
  });
  return rows.map((r) => ({ ...r, url: inviteUrl(r.token) }));
}

/** Returns the invite with its meeting when the token is valid: not revoked, meeting not deleted. */
export async function resolveInvite(token: string): Promise<ResolvedInvite | null> {
  if (!token || token.length > 64) return null;
  const [row] = await db
    .select({
      invite: meetingInvites,
      meeting: { id: meetings.id, title: meetings.title, startsAt: meetings.startsAt, kind: meetings.kind, status: meetings.status, deletedAt: meetings.deletedAt },
      space: { id: meetingSpaces.id, name: meetingSpaces.name, slug: meetingSpaces.slug },
    })
    .from(meetingInvites)
    .innerJoin(meetings, eq(meetings.id, meetingInvites.meetingId))
    .innerJoin(meetingSpaces, eq(meetingSpaces.id, meetings.spaceId))
    .where(eq(meetingInvites.token, token))
    .limit(1);
  if (!row || row.invite.revokedAt || row.meeting.deletedAt) return null;
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

export type InviteSource = { inviteId: string; label: string; meetingId: string; meetingTitle: string; href: string };

/** Which invite link each of the given users registered through (for the member list). */
export async function inviteSourcesForUsers(userIds: string[]): Promise<Map<string, InviteSource>> {
  const out = new Map<string, InviteSource>();
  if (userIds.length === 0) return out;
  const rows = await db
    .select({ userId: users.id, inviteId: meetingInvites.id, label: meetingInvites.label, meetingId: meetings.id, meetingTitle: meetings.title, slug: meetingSpaces.slug })
    .from(users)
    .innerJoin(meetingInvites, eq(meetingInvites.id, users.invitedViaId))
    .innerJoin(meetings, eq(meetings.id, meetingInvites.meetingId))
    .innerJoin(meetingSpaces, eq(meetingSpaces.id, meetings.spaceId))
    .where(inArray(users.id, userIds));
  for (const r of rows) out.set(r.userId, { inviteId: r.inviteId, label: r.label, meetingId: r.meetingId, meetingTitle: r.meetingTitle, href: meetingHref(r.slug, r.meetingId) });
  return out;
}
