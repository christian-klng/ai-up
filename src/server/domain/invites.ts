import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLog, communityMembers, meetingInvites, meetingSpaces, meetings, users, type CommunityMember, type MeetingInvite, type MeetingKind, type MeetingStatus } from "@/server/db/schema";
import { emitDomainEvent } from "@/server/events/bus";
import { env } from "@/server/env";
import { addMembership } from "./communities";

/**
 * Meeting invite link (one per meeting, admins only, off by default).
 *
 * The link is a random token; the public page /invite/<token> lets people register and activates the
 * membership right away (the admin vouches by switching the link on). The membership remembers the
 * link it came through (community_members.invitedViaId = the meeting) and is taken to the meeting
 * page once after signing in.
 */

export type ResolvedInvite = {
  invite: MeetingInvite;
  /** The community the meeting belongs to – registration through the link joins exactly this one. */
  communityId: string;
  meeting: { id: string; title: string; description: string | null; startsAt: Date | null; kind: MeetingKind; status: MeetingStatus; recordingEnabled: boolean; coverMediaId: string | null };
  /** avatars are served publicly, so the host can be shown on the invite page */
  host: { id: string; name: string; avatarMediaId: string | null } | null;
  space: { id: string; name: string; slug: string; icon: string };
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
      meeting: { id: meetings.id, title: meetings.title, description: meetings.description, startsAt: meetings.startsAt, kind: meetings.kind, status: meetings.status, recordingEnabled: meetings.recordingEnabled, coverMediaId: meetings.coverMediaId, deletedAt: meetings.deletedAt },
      host: { id: users.id, name: users.name, avatarMediaId: users.avatarMediaId },
      space: { id: meetingSpaces.id, name: meetingSpaces.name, slug: meetingSpaces.slug, icon: meetingSpaces.icon },
      communityId: meetingSpaces.communityId,
    })
    .from(meetingInvites)
    .innerJoin(meetings, eq(meetings.id, meetingInvites.meetingId))
    .innerJoin(meetingSpaces, eq(meetingSpaces.id, meetings.spaceId))
    .leftJoin(users, eq(users.id, meetings.hostId))
    .where(eq(meetingInvites.token, token))
    .limit(1);
  if (!row || !row.invite.enabled || row.meeting.deletedAt) return null;
  const { deletedAt: _deleted, ...meeting } = row.meeting;
  void _deleted;
  return { invite: row.invite, communityId: row.communityId, meeting, host: row.host?.id ? row.host : null, space: row.space, href: meetingHref(row.space.slug, row.meeting.id) };
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
export async function pendingInviteRedirect(membership: Pick<CommunityMember, "invitedViaId" | "inviteLandedAt">): Promise<string | null> {
  if (!membership.invitedViaId || membership.inviteLandedAt) return null;
  const [row] = await db
    .select({ meetingId: meetings.id, slug: meetingSpaces.slug, deletedAt: meetings.deletedAt })
    .from(meetingInvites)
    .innerJoin(meetings, eq(meetings.id, meetingInvites.meetingId))
    .innerJoin(meetingSpaces, eq(meetingSpaces.id, meetings.spaceId))
    .where(eq(meetingInvites.id, membership.invitedViaId))
    .limit(1);
  if (!row || row.deletedAt) return null;
  return meetingHref(row.slug, row.meetingId);
}

export async function markInviteLanded(communityId: string, userId: string): Promise<void> {
  await db
    .update(communityMembers)
    .set({ inviteLandedAt: new Date() })
    .where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.userId, userId), isNull(communityMembers.inviteLandedAt)));
}

export type InviteSource = { inviteId: string; meetingId: string; meetingTitle: string; href: string };

/** Which meeting each of the given users was invited to (for the member list). */
export async function inviteSourcesForUsers(communityId: string, userIds: string[]): Promise<Map<string, InviteSource>> {
  const out = new Map<string, InviteSource>();
  if (userIds.length === 0) return out;
  const rows = await db
    .select({ userId: communityMembers.userId, inviteId: meetingInvites.id, meetingId: meetings.id, meetingTitle: meetings.title, slug: meetingSpaces.slug })
    .from(communityMembers)
    .innerJoin(meetingInvites, eq(meetingInvites.id, communityMembers.invitedViaId))
    .innerJoin(meetings, eq(meetings.id, meetingInvites.meetingId))
    .innerJoin(meetingSpaces, eq(meetingSpaces.id, meetings.spaceId))
    .where(and(eq(communityMembers.communityId, communityId), inArray(communityMembers.userId, userIds)));
  for (const r of rows) out.set(r.userId, { inviteId: r.inviteId, meetingId: r.meetingId, meetingTitle: r.meetingTitle, href: meetingHref(r.slug, r.meetingId) });
  return out;
}

export type MeetingJoinResult = { ok: true; href: string; alreadyMember: boolean } | { ok: false; reason: "invalid" | "suspended" };

/**
 * Lets a signed-in account join the meeting's community through the link. The meeting link is an
 * invitation into the community too – that is what made registration through it active from the
 * start – so someone who is signed in with a *different* community gets the same offer instead of
 * being forwarded into a meeting they cannot see.
 *
 * A suspended membership is not revived, mirroring the community join link.
 */
export async function joinViaMeetingInvite(token: string, userId: string): Promise<MeetingJoinResult> {
  const resolved = await resolveInvite(token);
  if (!resolved) return { ok: false, reason: "invalid" };

  const existing = await db.query.communityMembers.findFirst({
    where: and(eq(communityMembers.communityId, resolved.communityId), eq(communityMembers.userId, userId)),
  });
  if (existing?.status === "suspended") return { ok: false, reason: "suspended" };
  if (existing?.status === "active") return { ok: true, href: resolved.href, alreadyMember: true };

  if (existing) {
    await db
      .update(communityMembers)
      .set({ status: "active", approvedAt: new Date(), approvedBy: resolved.invite.createdBy, invitedViaId: resolved.invite.id })
      .where(and(eq(communityMembers.communityId, resolved.communityId), eq(communityMembers.userId, userId)));
  } else {
    await addMembership({
      communityId: resolved.communityId,
      userId,
      status: "active",
      approvedBy: resolved.invite.createdBy,
      invitedViaId: resolved.invite.id,
    });
  }
  await countInviteUse(resolved.invite.id);
  await db.insert(auditLog).values({
    communityId: resolved.communityId,
    actorId: userId,
    action: "member.joined",
    targetType: "user",
    targetId: userId,
    details: { inviteId: resolved.invite.id, meetingId: resolved.meeting.id },
  });

  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (user) {
    emitDomainEvent("member.approved", resolved.communityId, {
      user: { id: user.id, name: user.name, email: user.email, locale: user.locale, registrationMessage: null },
      href: `/members/${user.id}`,
      invite: { id: resolved.invite.id, meetingId: resolved.meeting.id, meetingTitle: resolved.meeting.title, meetingHref: resolved.href },
      actorId: resolved.invite.createdBy,
      origin: { kind: "user" },
    });
  }
  return { ok: true, href: resolved.href, alreadyMember: false };
}
