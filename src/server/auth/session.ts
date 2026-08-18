import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { auth } from "./auth";
import { getUserById, touchLastSeen, updateProfile } from "@/server/domain/users";
import { generateRandomAvatar } from "@/server/media/avatars";
import type { User } from "@/server/db/schema";

export type CurrentUser = User;

/**
 * Returns the current user (fresh from DB so status/role changes apply immediately) or null.
 * Memoized per request.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;
  let user = await getUserById(session.user.id);
  if (!user) return null;
  if (!user.avatarMediaId) {
    // Seeded/legacy accounts: give them a random avatar on first visit.
    try {
      const avatar = await generateRandomAvatar(user.id);
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

/** Requires a signed-in, active user. Redirects otherwise. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "active") redirect("/pending");
  return user;
}

/** Requires an active admin. */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/");
  return user;
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
