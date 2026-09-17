import { and, asc, desc, eq, isNotNull, isNull, lt, ne, sql } from "drizzle-orm";
import { cache } from "react";
import { checkCommunitySlug, communityHost, communityPath, hostOf } from "@/lib/community";
import { env } from "@/server/env";
import { primaryHostOf } from "./community-domains";
import { db } from "@/server/db/client";
import {
  auditLog,
  communities,
  communityMembers,
  ROOT_COMMUNITY_ID,
  users,
  type Community,
  type CommunityMember,
  type MemberRole,
  type MemberStatus,
  type ThemeSettings,
} from "@/server/db/schema";

export { ROOT_COMMUNITY_ID };

export const DEFAULT_THEME: ThemeSettings = { primaryColor: "#2563eb", radius: 0.5, mode: "system" };

/**
 * Communities are the tenant boundary: every domain function takes the community explicitly rather
 * than reading an ambient "current tenant". The worker, the workflow dispatcher and MCP have no
 * request, so an implicit context would be empty or wrong exactly there (see docs/communities.md §3).
 */

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Loads one community (including soft-deleted ones – callers decide). Worker-safe. */
export async function loadCommunity(id: string): Promise<Community | undefined> {
  return db.query.communities.findFirst({ where: eq(communities.id, id) });
}

/** Request-memoized variant for React Server Components; the worker uses `loadCommunity()`. */
export const getCommunity = cache(loadCommunity);

/**
 * The installation's own community. Created on demand so a fresh database (and every test) has one.
 * Used wherever there is no community context: sign-in page, outgoing mail, the main domain's landing.
 */
export async function loadRootCommunity(): Promise<Community> {
  const row = await db.query.communities.findFirst({ where: eq(communities.id, ROOT_COMMUNITY_ID) });
  if (row) return row;
  const [created] = await db
    .insert(communities)
    .values({ id: ROOT_COMMUNITY_ID, slug: ROOT_COMMUNITY_ID })
    .onConflictDoNothing()
    .returning();
  return created ?? (await db.query.communities.findFirst({ where: eq(communities.id, ROOT_COMMUNITY_ID) }))!;
}

export const getRootCommunity = cache(loadRootCommunity);

export function isRootCommunity(community: Pick<Community, "id">): boolean {
  return community.id === ROOT_COMMUNITY_ID;
}

/**
 * Absolute URL that lands in this community – for links that leave the app (mail, OpenGraph).
 *
 * Three ways, most specific first: the community's own verified domain, then its sub-domain when
 * those are switched on – in both cases the community *is* a host, so the link needs no prefix and
 * survives being opened in a browser that was last in another community – and otherwise the
 * `/c/<slug>` prefix, which does the same job with one redirect.
 *
 * Asynchronous because of the first case: the domain lives in the database. Callers are in async
 * code anyway, and building a link is never on a hot path.
 */
export async function communityUrl(community: Pick<Community, "id" | "slug">, path = "/home"): Promise<string> {
  const app = new URL(env.APP_URL);
  const port = app.port ? `:${app.port}` : "";
  const clean = path.startsWith("/") ? path : `/${path}`;

  const own = await primaryHostOf(community.id);
  if (own) return `${app.protocol}//${own}${port}${clean}`;

  if (env.COMMUNITY_SUBDOMAINS) {
    app.host = communityHost(community.slug, hostOf(env.APP_URL)) + port;
    return `${app.origin}${clean}`;
  }
  return `${env.APP_URL.replace(/\/$/, "")}${communityPath(community.slug, path)}`;
}

/** Live sub-communities with their member count – the operator's overview. */
export async function listSubCommunities(opts: { includeDeleted?: boolean } = {}): Promise<(Community & { memberCount: number })[]> {
  const rows = await db
    .select({
      community: communities,
      memberCount: sql<number>`(select count(*)::int from ${communityMembers}
        where ${communityMembers}."community_id" = ${communities}."id" and ${communityMembers}."status" = 'active')`,
    })
    .from(communities)
    .where(and(ne(communities.id, ROOT_COMMUNITY_ID), opts.includeDeleted ? undefined : isNull(communities.deletedAt)))
    .orderBy(desc(communities.createdAt));
  return rows.map((r) => ({ ...r.community, memberCount: r.memberCount }));
}

export async function getCommunityBySlug(slug: string): Promise<Community | undefined> {
  return db.query.communities.findFirst({ where: and(eq(communities.slug, slug.toLowerCase()), isNull(communities.deletedAt)) });
}

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

/** The membership row, or undefined when the account does not belong to that community at all. */
export async function getMembership(communityId: string, userId: string): Promise<CommunityMember | undefined> {
  return db.query.communityMembers.findFirst({
    where: and(eq(communityMembers.communityId, communityId), eq(communityMembers.userId, userId)),
  });
}

export type MembershipWithCommunity = CommunityMember & { community: Community };

/**
 * Every community the account belongs to, root first, then alphabetically. Soft-deleted communities
 * are left out – they must not appear in the switcher.
 */
export async function listMembershipsForUser(userId: string, opts: { status?: MemberStatus } = {}): Promise<MembershipWithCommunity[]> {
  const rows = await db
    .select({ membership: communityMembers, community: communities })
    .from(communityMembers)
    .innerJoin(communities, eq(communities.id, communityMembers.communityId))
    .where(
      and(
        eq(communityMembers.userId, userId),
        isNull(communities.deletedAt),
        opts.status ? eq(communityMembers.status, opts.status) : undefined,
      ),
    )
    .orderBy(desc(eq(communities.id, ROOT_COMMUNITY_ID)), asc(communities.name));
  return rows.map((r) => ({ ...r.membership, community: r.community }));
}

/**
 * Adds a membership (or returns the existing one untouched). `status` decides whether the person is
 * in right away – invite links hand in "active", the registration form "pending".
 */
export async function addMembership(input: {
  communityId: string;
  userId: string;
  role?: MemberRole;
  status?: MemberStatus;
  registrationMessage?: string | null;
  approvedBy?: string | null;
  invitedViaId?: string | null;
}): Promise<CommunityMember> {
  const existing = await getMembership(input.communityId, input.userId);
  if (existing) return existing;
  const status = input.status ?? "pending";
  const [row] = await db
    .insert(communityMembers)
    .values({
      communityId: input.communityId,
      userId: input.userId,
      role: input.role ?? "member",
      status,
      registrationMessage: input.registrationMessage ?? null,
      approvedBy: input.approvedBy ?? null,
      approvedAt: status === "active" ? new Date() : null,
      invitedViaId: input.invitedViaId ?? null,
    })
    .onConflictDoNothing()
    .returning();
  return row ?? (await getMembership(input.communityId, input.userId))!;
}

/**
 * Whether this membership is the community's last active admin. Losing it would leave the community
 * without anyone who can administer it – so demoting, suspending or removing them is refused.
 */
export async function isLastAdmin(communityId: string, userId: string): Promise<boolean> {
  const membership = await getMembership(communityId, userId);
  if (!membership || membership.role !== "admin" || membership.status !== "active") return false;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(communityMembers)
    .innerJoin(users, eq(users.id, communityMembers.userId))
    .where(
      and(
        eq(communityMembers.communityId, communityId),
        eq(communityMembers.role, "admin"),
        eq(communityMembers.status, "active"),
        eq(users.isBot, false),
        ne(communityMembers.userId, userId),
      ),
    );
  return (row?.count ?? 0) === 0;
}

/** Removes someone from one community. The account stays – they may be a member elsewhere. */
export async function removeMembership(communityId: string, userId: string, actorId: string): Promise<void> {
  await db.delete(communityMembers).where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.userId, userId)));
  await db.insert(auditLog).values({ communityId, actorId, action: "member.removed", targetType: "user", targetId: userId });
}

export async function setMembershipStatus(communityId: string, userId: string, status: MemberStatus, actorId: string): Promise<void> {
  await db
    .update(communityMembers)
    .set({ status, ...(status === "active" ? { approvedAt: new Date(), approvedBy: actorId } : {}) })
    .where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.userId, userId)));
  await db.insert(auditLog).values({
    communityId,
    actorId,
    action: `member.status.${status}`,
    targetType: "user",
    targetId: userId,
  });
}

export async function setMembershipRole(communityId: string, userId: string, role: MemberRole, actorId: string): Promise<void> {
  await db
    .update(communityMembers)
    .set({ role })
    .where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.userId, userId)));
  await db.insert(auditLog).values({ communityId, actorId, action: `member.role.${role}`, targetType: "user", targetId: userId });
}

/** Ids of the active admins of a community – the audience for "notify admins". */
export async function listAdminIds(communityId: string): Promise<string[]> {
  const rows = await db
    .select({ id: communityMembers.userId })
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
  return rows.map((r) => r.id);
}

/** Ids of every active member – the audience for "notify all". Excludes the community's bot. */
export async function listActiveMemberIds(communityId: string): Promise<string[]> {
  const rows = await db
    .select({ id: communityMembers.userId })
    .from(communityMembers)
    .innerJoin(users, eq(users.id, communityMembers.userId))
    .where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.status, "active"), eq(users.isBot, false)));
  return rows.map((r) => r.id);
}

export async function touchMembershipSeen(communityId: string, userId: string): Promise<void> {
  await db
    .update(communityMembers)
    .set({ lastSeenAt: new Date() })
    .where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.userId, userId)));
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export type UpdateCommunityInput = Partial<
  Pick<
    Community,
    | "name"
    | "tagline"
    | "purpose"
    | "logoMediaId"
    | "faviconMediaId"
    | "defaultLocale"
    | "theme"
    | "botName"
    | "agentWeeklyTokenBudget"
    | "agentOutputTokenWeight"
    | "landingEnabled"
    | "imprintEnabled"
    | "privacyEnabled"
    | "allowMemberSubcommunities"
    | "allowRegistration"
  >
>;

export async function updateCommunity(id: string, input: UpdateCommunityInput): Promise<Community> {
  const [row] = await db.update(communities).set(input).where(eq(communities.id, id)).returning();
  return row;
}

// ---------------------------------------------------------------------------
// Creating and deleting
// ---------------------------------------------------------------------------

export type CreateCommunityInput = { name: string; slug: string; purpose: string; defaultLocale?: Community["defaultLocale"] };
export type CreateCommunityResult = { ok: true; community: Community } | { ok: false; reason: "slugTaken" | "slugInvalid" | "notAllowed" };

/**
 * Creates a sub-community and makes `founderId` its admin.
 *
 * Only one level deep: the parent is always the root. A chain of sub-communities would immediately
 * raise questions this does not need to answer (who may pass the permission on, whose deletion takes
 * what with it – see docs/communities.md §1.3).
 *
 * The community starts usable rather than empty: one collection and one meeting space, plus its own
 * system agent and bot user. What it does *not* get is integrations – LiveKit and the recording
 * storage stay the operator's and are shared.
 */
export async function createCommunity(input: CreateCommunityInput, founderId: string): Promise<CreateCommunityResult> {
  const checked = checkCommunitySlug(input.slug);
  if (!checked.ok) return { ok: false, reason: "slugInvalid" };
  if (await db.query.communities.findFirst({ where: eq(communities.slug, checked.slug), columns: { id: true } })) {
    return { ok: false, reason: "slugTaken" };
  }

  const id = crypto.randomUUID();
  const [community] = await db
    .insert(communities)
    .values({
      id,
      slug: checked.slug,
      parentId: ROOT_COMMUNITY_ID,
      name: input.name.trim().slice(0, 80),
      purpose: input.purpose.trim().slice(0, 4000) || null,
      defaultLocale: input.defaultLocale ?? "de",
      // A fresh community is closed: people come in through its join link, which its admin controls.
      allowRegistration: false,
      createdBy: founderId,
    })
    .returning();

  await addMembership({ communityId: id, userId: founderId, role: "admin", status: "active", approvedBy: founderId });
  await db.insert(auditLog).values({ communityId: id, actorId: founderId, action: "community.created", targetType: "community", targetId: id, details: { name: community.name, slug: community.slug } });
  return { ok: true, community };
}

/**
 * Switches a community off without destroying anything yet: it disappears from the switcher and
 * every guard, but the rows stay for the grace period so an accidental deletion can be undone.
 * The root community is never deletable.
 */
export async function softDeleteCommunity(id: string, actorId: string): Promise<{ ok: boolean; reason?: "root" | "notFound" }> {
  if (id === ROOT_COMMUNITY_ID) return { ok: false, reason: "root" };
  const [row] = await db.update(communities).set({ deletedAt: new Date() }).where(and(eq(communities.id, id), isNull(communities.deletedAt))).returning();
  if (!row) return { ok: false, reason: "notFound" };
  await db.insert(auditLog).values({ actorId, action: "community.deleted", targetType: "community", targetId: id, details: { name: row.name, slug: row.slug } });
  return { ok: true };
}

export async function restoreCommunity(id: string, actorId: string): Promise<boolean> {
  const [row] = await db.update(communities).set({ deletedAt: null }).where(eq(communities.id, id)).returning();
  if (!row) return false;
  await db.insert(auditLog).values({ communityId: id, actorId, action: "community.restored", targetType: "community", targetId: id, details: { name: row.name } });
  return true;
}

/** Communities whose grace period has run out and that the worker may now purge for good. */
export async function listCommunitiesToPurge(graceDays: number): Promise<Community[]> {
  const cutoff = new Date(Date.now() - graceDays * 86_400_000);
  return db.query.communities.findMany({
    where: and(ne(communities.id, ROOT_COMMUNITY_ID), isNotNull(communities.deletedAt), lt(communities.deletedAt, cutoff)),
  });
}
