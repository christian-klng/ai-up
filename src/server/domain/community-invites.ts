import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLog, communities, communityInvites, communityMembers, users, type Community, type CommunityInvite } from "@/server/db/schema";
import { emitDomainEvent } from "@/server/events/bus";
import { env } from "@/server/env";
import { addMembership } from "./communities";

/**
 * The join link of a community (one per community, admins only, off by default).
 *
 * Same principle as the meeting invite link (domain/invites.ts): a random token, and while the link
 * is **enabled** anyone holding it becomes an active member right away – the admin vouches for the
 * link by switching it on. Switching it off keeps the token, so a link handed out earlier works
 * again after re-enabling, and members who already joined stay.
 *
 * Deliberately no "joined via" column: the counter on the link is enough to see whether it is being
 * used, and the meeting link already covers the one origin that is worth showing per member.
 */

export function joinUrl(token: string): string {
  return `${env.APP_URL}/join/${token}`;
}

export type InviteWithUrl = CommunityInvite & { url: string };

export async function getCommunityInvite(communityId: string): Promise<InviteWithUrl | undefined> {
  const row = await db.query.communityInvites.findFirst({ where: eq(communityInvites.communityId, communityId) });
  return row ? { ...row, url: joinUrl(row.token) } : undefined;
}

/** Switches the link on or off; the row (and the URL) is created on first use. */
export async function setCommunityInviteEnabled(communityId: string, enabled: boolean, actorId: string): Promise<InviteWithUrl> {
  const existing = await db.query.communityInvites.findFirst({ where: eq(communityInvites.communityId, communityId) });
  let row: CommunityInvite;
  if (existing) {
    [row] = await db.update(communityInvites).set({ enabled }).where(eq(communityInvites.id, existing.id)).returning();
  } else {
    [row] = await db
      .insert(communityInvites)
      .values({ communityId, token: randomBytes(24).toString("base64url"), enabled, createdBy: actorId })
      .returning();
  }
  if (!existing || existing.enabled !== enabled) {
    await db.insert(auditLog).values({
      communityId,
      actorId,
      action: enabled ? "community.invite.enabled" : "community.invite.disabled",
      targetType: "community_invite",
      targetId: row.id,
    });
  }
  return { ...row, url: joinUrl(row.token) };
}

export type ResolvedCommunityInvite = { invite: CommunityInvite; community: Community };

/** Returns the invite and its community when the token is valid: link enabled, community alive. */
export async function resolveCommunityInvite(token: string): Promise<ResolvedCommunityInvite | null> {
  if (!token || token.length > 64) return null;
  const [row] = await db
    .select({ invite: communityInvites, community: communities })
    .from(communityInvites)
    .innerJoin(communities, eq(communities.id, communityInvites.communityId))
    .where(eq(communityInvites.token, token))
    .limit(1);
  if (!row || !row.invite.enabled || row.community.deletedAt) return null;
  return { invite: row.invite, community: row.community };
}

/** Counts one more member who joined through the link. */
export async function countCommunityInviteUse(id: string): Promise<void> {
  await db
    .update(communityInvites)
    .set({ useCount: sql`${communityInvites.useCount} + 1` })
    .where(eq(communityInvites.id, id));
}

export type JoinResult = { ok: true; alreadyMember: boolean } | { ok: false; reason: "invalid" | "suspended" };

/**
 * Lets an account that already exists join through the link. Idempotent: someone who is already a
 * member just gets `alreadyMember`, so a shared link can be clicked twice without surprises.
 *
 * A membership that an admin *suspended* is not revived by the link – otherwise anyone thrown out
 * could walk back in through a URL they kept.
 */
export async function joinViaCommunityInvite(token: string, userId: string): Promise<JoinResult> {
  const resolved = await resolveCommunityInvite(token);
  if (!resolved) return { ok: false, reason: "invalid" };
  const { invite, community } = resolved;

  const existing = await db.query.communityMembers.findFirst({
    where: and(eq(communityMembers.communityId, community.id), eq(communityMembers.userId, userId)),
  });
  if (existing?.status === "suspended") return { ok: false, reason: "suspended" };
  if (existing?.status === "active") return { ok: true, alreadyMember: true };

  // A pending application is upgraded: the link vouches louder than the waiting list.
  if (existing) {
    await db
      .update(communityMembers)
      .set({ status: "active", approvedAt: new Date(), approvedBy: invite.createdBy })
      .where(and(eq(communityMembers.communityId, community.id), eq(communityMembers.userId, userId)));
  } else {
    await addMembership({ communityId: community.id, userId, status: "active", approvedBy: invite.createdBy });
  }
  await countCommunityInviteUse(invite.id);
  await db.insert(auditLog).values({
    communityId: community.id,
    actorId: userId,
    action: "member.joined",
    targetType: "user",
    targetId: userId,
    details: { joinLinkId: invite.id },
  });

  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (user) {
    emitDomainEvent("member.approved", community.id, {
      user: { id: user.id, name: user.name, email: user.email, locale: user.locale, registrationMessage: null },
      href: `/members/${user.id}`,
      invite: null,
      actorId: invite.createdBy,
      origin: { kind: "user" },
    });
  }
  return { ok: true, alreadyMember: false };
}
