import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLog, communityMembers, users, type CommunityMember, type MemberStatus, type User } from "@/server/db/schema";
import { emitDomainEvent, type MemberEventPayload } from "@/server/events/bus";
import { env } from "@/server/env";
import type { Locale } from "@/i18n/config";
import { logger } from "@/server/logger";
import { sendMail } from "@/server/mail/mailer";
import { accountApprovedMail, pendingMemberAdminMail } from "@/server/mail/templates";
import { generateRandomAvatar } from "@/server/media/avatars";
import { addMembership, communityUrl, getMembership, loadCommunity, listAdminIds } from "./communities";
import { countCommunityInviteUse } from "./community-invites";
import { countInviteUse } from "./invites";
import { createNotifications } from "./notifications";

/**
 * A member as other members see them. `role` and `status` come from the membership, not from the
 * account: the same person can be an admin here and a plain member next door.
 */
export type PublicUser = Pick<User, "id" | "name" | "bio" | "avatarMediaId" | "lastSeenAt" | "isBot"> & {
  role: CommunityMember["role"];
  status: CommunityMember["status"];
  /** When they joined *this* community – "member since", not when the account was created. */
  createdAt: Date;
  online: boolean;
};

const ONLINE_WINDOW = sql`interval '3 minutes'`;

export async function getUserByEmail(email: string): Promise<User | undefined> {
  return db.query.users.findFirst({ where: eq(users.email, email.toLowerCase().trim()) });
}

export async function getUserById(id: string): Promise<User | undefined> {
  return db.query.users.findFirst({ where: eq(users.id, id) });
}

/** Active admin accounts of one community (for mail and in-app notices). */
export async function listAdmins(communityId: string): Promise<User[]> {
  const rows = await db
    .select({ user: users })
    .from(communityMembers)
    .innerJoin(users, eq(users.id, communityMembers.userId))
    .where(
      and(
        eq(communityMembers.communityId, communityId),
        eq(communityMembers.role, "admin"),
        eq(communityMembers.status, "active"),
        eq(users.isBot, false),
      ),
    );
  return rows.map((r) => r.user);
}

function memberEventPayload(
  user: User,
  registrationMessage: string | null,
  href: string,
  actorId: string | null,
  invite: MemberEventPayload["invite"] = null,
): MemberEventPayload {
  return {
    user: { id: user.id, name: user.name, email: user.email, locale: user.locale, registrationMessage },
    href,
    actorId,
    invite,
    origin: { kind: "user" },
  };
}

/** Meeting invite link the registration came through – the membership is activated right away. `createdBy` = admin who set up the link. */
export type RegisterInvite = { id: string; createdBy: string | null; meetingId: string; meetingTitle: string; meetingHref: string };

export type RegisterInput = {
  communityId: string;
  email: string;
  name: string;
  locale: Locale;
  message?: string | null;
  /** Meeting invite link: activates the membership and remembers which meeting it came through. */
  invite?: RegisterInvite | null;
  /** Community join link: activates the membership too, but has no meeting to remember. */
  joinLink?: { id: string; approvedBy: string | null } | null;
};
export type RegisterResult = { ok: true; status: MemberStatus; user: User } | { ok: false; reason: "exists"; user: User };

/**
 * Registration creates the account if it is new and always creates the membership in
 * `input.communityId`. An account that already belongs to this community is reported as `exists`
 * (the UI shows a neutral message so the form cannot be used to probe for members); an account that
 * exists but is a stranger here simply gains a membership.
 *
 * Through a link – a meeting invite or the community's join link – the membership is `active` right
 * away (the admin vouched by handing the link out) and member.approved fires alongside
 * member.registered. Without one it stays `pending` and the community's admins are notified.
 */
export async function registerUser(input: RegisterInput): Promise<RegisterResult> {
  const email = input.email.toLowerCase().trim();
  const invite = input.invite ?? null;
  const joinLink = input.joinLink ?? null;
  const vouched = invite ?? joinLink;
  const message = input.message?.trim().slice(0, 1000) || null;
  const existing = await getUserByEmail(email);

  if (existing) {
    const membership = await getMembership(input.communityId, existing.id);
    if (membership) return { ok: false, reason: "exists", user: existing };
  }

  let user = existing;
  if (!user) {
    const id = crypto.randomUUID();
    [user] = await db
      .insert(users)
      .values({
        id,
        email,
        name: input.name.trim().slice(0, 120),
        emailVerified: false,
        // The account may sign in as soon as one community has let it in; membership decides the rest.
        status: vouched ? "active" : "pending",
        locale: input.locale,
      })
      .returning();
    try {
      const avatar = await generateRandomAvatar({ seed: id, uploadedBy: id });
      await db.update(users).set({ avatarMediaId: avatar.id }).where(eq(users.id, id));
    } catch (err) {
      logger.error({ err, userId: id }, "avatar generation failed");
    }
  }

  const membership = await addMembership({
    communityId: input.communityId,
    userId: user.id,
    status: vouched ? "active" : "pending",
    registrationMessage: message,
    approvedBy: invite?.createdBy ?? joinLink?.approvedBy ?? null,
    invitedViaId: invite?.id ?? null,
  });

  if (joinLink) {
    await db.insert(auditLog).values({
      communityId: input.communityId,
      actorId: user.id,
      action: "user.registered",
      targetType: "user",
      targetId: user.id,
      details: { joinLinkId: joinLink.id },
    });
    await countCommunityInviteUse(joinLink.id);
    emitDomainEvent("member.registered", input.communityId, memberEventPayload(user, message, `/members/${user.id}`, user.id));
    emitDomainEvent("member.approved", input.communityId, memberEventPayload(user, message, `/members/${user.id}`, joinLink.approvedBy));
    return { ok: true, status: membership.status, user };
  }

  if (invite) {
    await db.insert(auditLog).values({
      communityId: input.communityId,
      actorId: user.id,
      action: "user.registered",
      targetType: "user",
      targetId: user.id,
      details: { inviteId: invite.id, meetingId: invite.meetingId },
    });
    await countInviteUse(invite.id);
    const eventInvite = { id: invite.id, meetingId: invite.meetingId, meetingTitle: invite.meetingTitle, meetingHref: invite.meetingHref };
    emitDomainEvent("member.registered", input.communityId, memberEventPayload(user, message, `/members/${user.id}`, user.id, eventInvite));
    emitDomainEvent("member.approved", input.communityId, memberEventPayload(user, message, `/members/${user.id}`, invite.createdBy, eventInvite));
    return { ok: true, status: membership.status, user };
  }

  await db.insert(auditLog).values({ communityId: input.communityId, actorId: user.id, action: "user.registered", targetType: "user", targetId: user.id });
  emitDomainEvent("member.registered", input.communityId, memberEventPayload(user, message, "/admin/members?status=pending", user.id));

  // Notify this community's admins in-app + by mail (best effort)
  try {
    const [admins, community] = await Promise.all([listAdmins(input.communityId), loadCommunity(input.communityId)]);
    const appName = community?.name ?? "AI-Up";
    await createNotifications(
      admins.map((a) => ({
        communityId: input.communityId,
        userId: a.id,
        type: "member.pending",
        title: a.locale === "en" ? `New registration: ${user.name}` : `Neue Registrierung: ${user.name}`,
        body: user.email,
        data: { href: "/admin/members?status=pending", userId: user.id },
      })),
    );
    const reviewUrl = community ? await communityUrl(community, "/admin/members?status=pending") : undefined;
    await Promise.allSettled(
      admins.map((a) =>
        sendMail(
          pendingMemberAdminMail({ appName, appUrl: env.APP_URL, locale: a.locale }, a.email, { ...user, registrationMessage: message }, reviewUrl),
        ),
      ),
    );
  } catch (err) {
    logger.error({ err }, "admin notification for registration failed");
  }

  return { ok: true, status: membership.status, user };
}

/**
 * Approves a membership. The account is unlocked too if this is the first community that lets it in
 * – without that it could never sign in to reach the community that just approved it.
 */
export async function approveMember(
  communityId: string,
  userId: string,
  actorId: string,
  sendLink: (email: string) => Promise<void>,
): Promise<User | undefined> {
  const membership = await getMembership(communityId, userId);
  if (!membership || membership.status === "active") return undefined;
  const user = await getUserById(userId);
  if (!user) return undefined;

  await db
    .update(communityMembers)
    .set({ status: "active", approvedAt: new Date(), approvedBy: actorId })
    .where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.userId, userId)));
  if (user.status === "pending") await db.update(users).set({ status: "active" }).where(eq(users.id, userId));

  await db.insert(auditLog).values({ communityId, actorId, action: "user.approved", targetType: "user", targetId: userId });
  emitDomainEvent("member.approved", communityId, memberEventPayload(user, membership.registrationMessage, `/members/${user.id}`, actorId));
  await createNotifications([
    {
      communityId,
      userId,
      type: "member.approved",
      title: user.locale === "en" ? "Your account has been approved" : "Dein Konto wurde freigeschaltet",
      data: { href: "/home" },
    },
  ]);
  try {
    const community = await loadCommunity(communityId);
    // The sign-in link carries the community they were approved in as its destination.
    const next = community ? await communityUrl(community, "/home") : `${env.APP_URL}/home`;
    await sendMail(
      accountApprovedMail(
        { appName: community?.name ?? "AI-Up", appUrl: env.APP_URL, locale: user.locale },
        user.email,
        `${env.APP_URL}/login?next=${encodeURIComponent(new URL(next).pathname)}`,
      ),
    );
    await sendLink(user.email);
  } catch (err) {
    logger.error({ err, userId }, "approval mail failed");
  }
  return user;
}

/** Account-level lock (all communities at once). Per-community suspension is `setMembershipStatus`. */
export async function setAccountStatus(userId: string, status: User["status"], actorId: string): Promise<void> {
  await db.update(users).set({ status }).where(eq(users.id, userId));
  await db.insert(auditLog).values({ actorId, action: `user.status.${status}`, targetType: "user", targetId: userId });
}

export async function updateProfile(userId: string, patch: Partial<Pick<User, "name" | "bio" | "locale" | "avatarMediaId">>): Promise<User> {
  const [row] = await db.update(users).set(patch).where(eq(users.id, userId)).returning();
  return row;
}

export async function touchLastSeen(userId: string): Promise<void> {
  // Cheap write; throttled by caller (only if older than 60s).
  await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, userId));
}

/**
 * A member row for the admin list. `role` and `status` are the **membership's**, shadowing the
 * account columns of the same name – reading `users.role` here would show the deprecated account
 * flag and, in a sub-community, simply the wrong answer.
 */
export type MemberListRow = Omit<User, "role" | "status"> & {
  role: CommunityMember["role"];
  status: CommunityMember["status"];
  /** When this account joined *this* community (not when the account was created). */
  joinedAt: Date;
  membership: CommunityMember;
};

/** Members of one community for the admin list (any status). */
export async function listMembers(
  communityId: string,
  opts: { status?: MemberStatus; query?: string; limit?: number } = {},
): Promise<MemberListRow[]> {
  const conds = [eq(communityMembers.communityId, communityId), eq(users.isBot, false)];
  if (opts.status) conds.push(eq(communityMembers.status, opts.status));
  if (opts.query) {
    const q = `%${opts.query.trim()}%`;
    conds.push(or(ilike(users.name, q), ilike(users.email, q))!);
  }
  const rows = await db
    .select({ user: users, membership: communityMembers })
    .from(communityMembers)
    .innerJoin(users, eq(users.id, communityMembers.userId))
    .where(and(...conds))
    .orderBy(desc(communityMembers.joinedAt))
    .limit(opts.limit ?? 200);
  return rows.map((r) => ({ ...r.user, role: r.membership.role, status: r.membership.status, joinedAt: r.membership.joinedAt, membership: r.membership }));
}

/** Active members of one community, as shown to other members. */
export async function listActiveMembers(communityId: string, query?: string): Promise<PublicUser[]> {
  const conds = [eq(communityMembers.communityId, communityId), eq(communityMembers.status, "active"), eq(users.isBot, false)];
  if (query) conds.push(ilike(users.name, `%${query.trim()}%`));
  return db
    .select({
      id: users.id,
      name: users.name,
      bio: users.bio,
      avatarMediaId: users.avatarMediaId,
      role: communityMembers.role,
      status: communityMembers.status,
      lastSeenAt: users.lastSeenAt,
      createdAt: communityMembers.joinedAt,
      isBot: users.isBot,
      online: sql<boolean>`coalesce(${users.lastSeenAt} > now() - ${ONLINE_WINDOW}, false)`,
    })
    .from(communityMembers)
    .innerJoin(users, eq(users.id, communityMembers.userId))
    .where(and(...conds))
    .orderBy(asc(users.name));
}

export async function countMembersByStatus(communityId: string): Promise<Record<MemberStatus, number>> {
  const rows = await db
    .select({ status: communityMembers.status, count: sql<number>`count(*)::int` })
    .from(communityMembers)
    .innerJoin(users, eq(users.id, communityMembers.userId))
    .where(and(eq(communityMembers.communityId, communityId), eq(users.isBot, false)))
    .groupBy(communityMembers.status);
  const out: Record<MemberStatus, number> = { pending: 0, active: 0, suspended: 0 };
  for (const r of rows) out[r.status] = r.count;
  return out;
}

/** One member's public profile *within a community* – undefined when they are not a member there. */
export async function getPublicUser(communityId: string, id: string): Promise<PublicUser | undefined> {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      bio: users.bio,
      avatarMediaId: users.avatarMediaId,
      role: communityMembers.role,
      status: communityMembers.status,
      lastSeenAt: users.lastSeenAt,
      createdAt: communityMembers.joinedAt,
      isBot: users.isBot,
      online: sql<boolean>`coalesce(${users.lastSeenAt} > now() - ${ONLINE_WINDOW}, false)`,
    })
    .from(communityMembers)
    .innerJoin(users, eq(users.id, communityMembers.userId))
    .where(and(eq(communityMembers.communityId, communityId), eq(users.id, id)))
    .limit(1);
  return rows[0];
}

export { listAdminIds };
