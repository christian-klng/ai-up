import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "./auth";
import { COMMUNITY_COOKIE, pickActiveCommunity } from "@/lib/community";
import { getHostCommunity, getPublicCommunity } from "@/server/community-context";
import { ROOT_COMMUNITY_ID, getMembership, listMembershipsForUser, touchMembershipSeen } from "@/server/domain/communities";
import { primaryHostOf } from "@/server/domain/community-domains";
import { env } from "@/server/env";
import { getUserById, touchLastSeen, updateProfile } from "@/server/domain/users";
import { generateRandomAvatar } from "@/server/media/avatars";
import type { Community, CommunityMember, MemberRole, User } from "@/server/db/schema";

/**
 * The signed-in account together with the community it is currently acting in.
 *
 * `role` deliberately shadows `users.role`: what someone may do is decided per community, so every
 * `user.role === "admin"` check in the app asks about the *active* community. The account column is
 * deprecated and never read for authorization (see docs/communities.md §1.1).
 */
export type CurrentUser = Omit<User, "role"> & {
  role: MemberRole;
  communityId: string;
  membership: CommunityMember;
};

/** The bare account, without any community context. Public routes and /pending use this. */
export const getAccount = cache(async (): Promise<User | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;
  let user = await getUserById(session.user.id);
  if (!user) return null;
  if (!user.avatarMediaId) {
    // Seeded/legacy accounts: give them a random avatar on first visit.
    try {
      const avatar = await generateRandomAvatar({ seed: user.id, uploadedBy: user.id });
      user = await updateProfile(user.id, { avatarMediaId: avatar.id });
    } catch {
      /* non-critical */
    }
  }
  const last = user.lastSeenAt?.getTime() ?? 0;
  if (Date.now() - last > 60_000) {
    // fire and forget; presence indicator only
    void touchLastSeen(user.id).catch(() => {});
  }
  return user;
});

/**
 * Which community this request acts in.
 *
 * 1. the host, when the community has its own sub-domain – it is unambiguous and shareable
 * 2. the `aiup_community` cookie on the main host, validated against the account's memberships
 * 3. the first active membership, root preferred
 *
 * Returns null when the visitor is signed out or belongs to no live community. A host naming a
 * community the account is not a member of also answers null: the page then says so rather than
 * quietly dropping the visitor into a different community than the link promised.
 */
export const getActiveCommunity = cache(async (): Promise<Community | null> => {
  const user = await getAccount();
  if (!user) return null;

  const memberships = await listMembershipsForUser(user.id, { status: "active" });
  if (memberships.length === 0) return null;

  const host = await getHostCommunity();
  if (host) return memberships.some((m) => m.communityId === host.id) ? host : null;

  const wanted = (await cookies()).get(COMMUNITY_COOKIE)?.value;
  return pickActiveCommunity(memberships, wanted)?.community ?? null;
});

/**
 * Returns the current user in the active community, or null when signed out or not an active
 * member anywhere. Memoized per request.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const [user, community] = await Promise.all([getAccount(), getActiveCommunity()]);
  if (!user || !community) return null;
  const membership = await getMembership(community.id, user.id);
  if (!membership || membership.status !== "active") return null;

  const last = membership.lastSeenAt?.getTime() ?? 0;
  if (Date.now() - last > 60_000) void touchMembershipSeen(community.id, user.id).catch(() => {});

  return { ...user, role: membership.role, communityId: community.id, membership };
});

/** Requires a signed-in account that is an active member of the community it is acting in. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (user) return user;
  const account = await getAccount();
  if (!account) redirect("/login");
  redirect("/pending");
}

/** Requires an admin **of the active community**. */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/home");
  return user;
}

/**
 * Requires an admin of the **root** community – the operator. Guards the settings that are shared by
 * every community and belong to whoever runs the installation: the integrations (LiveKit credentials
 * and the recording storage) and the platform-wide model capabilities. A sub-community admin is an
 * admin of their own community, not of the operator's infrastructure.
 */
export async function requireRootAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.communityId !== ROOT_COMMUNITY_ID || user.role !== "admin") redirect("/home");
  return user;
}

/** Server-action variant of `requireRootAdmin()`. */
export async function assertRootAdmin(): Promise<CurrentUser> {
  const user = await assertUser();
  if (user.communityId !== ROOT_COMMUNITY_ID || user.role !== "admin") throw new ForbiddenError("root admin required");
  return user;
}

/** Is this the operator's own community? Used to hide what only the operator may configure. */
export function isRootCommunityId(communityId: string): boolean {
  return communityId === ROOT_COMMUNITY_ID;
}

/**
 * May this community publish landing, imprint and privacy pages?
 *
 * Only a community that owns a host can: the root always does, every community does once sub-domains
 * are switched on, and one with a verified domain of its own does regardless. Without a host the
 * pages would be written and never served – and the imprint duty that comes with an own address is
 * exactly why this is tied to having one.
 */
export async function canManagePublicPages(communityId: string): Promise<boolean> {
  if (communityId === ROOT_COMMUNITY_ID || env.COMMUNITY_SUBDOMAINS) return true;
  return (await primaryHostOf(communityId)) !== null;
}

/** Page guard for the public-pages admin area. */
export async function requirePagesAdmin(): Promise<CurrentUser> {
  const user = await requireAdmin();
  if (!(await canManagePublicPages(user.communityId))) redirect("/admin/general");
  return user;
}

/** Server-action variant of `requirePagesAdmin()`. */
export async function assertPagesAdmin(): Promise<CurrentUser> {
  const user = await assertAdmin();
  if (!(await canManagePublicPages(user.communityId))) throw new ForbiddenError("this community has no public pages");
  return user;
}

/** The active community for pages that already know there is one (layouts behind requireUser). */
export async function requireCommunity(): Promise<Community> {
  const community = await getActiveCommunity();
  if (community) return community;
  const account = await getAccount();
  if (!account) redirect("/login");
  redirect("/pending");
}

// Host resolution lives in server/community-context.ts so the auth config can use it too; these
// re-exports keep `@/server/auth/session` the single import for everything session-related.
export { getHostCommunity, getPublicCommunity };

/**
 * The community whose name, logo, favicon and theme the page should wear: the one the visitor is
 * acting in, or the public one when signed out. Used by the root layout, so a member inside a
 * sub-community sees its branding rather than the operator's.
 */
export async function getBrandingCommunity(): Promise<Community> {
  return (await getActiveCommunity()) ?? (await getPublicCommunity());
}

export class ForbiddenError extends Error {
  constructor(message = "forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** For server actions / route handlers: throws instead of redirecting. */
export async function assertUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") throw new ForbiddenError("unauthenticated");
  return user;
}

export async function assertAdmin(): Promise<CurrentUser> {
  const user = await assertUser();
  if (user.role !== "admin") throw new ForbiddenError("admin required");
  return user;
}

