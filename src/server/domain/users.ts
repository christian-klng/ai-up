import { and, asc, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLog, users, type User } from "@/server/db/schema";
import { env } from "@/server/env";
import type { Locale } from "@/i18n/config";
import { logger } from "@/server/logger";
import { sendMail } from "@/server/mail/mailer";
import { accountApprovedMail, pendingMemberAdminMail } from "@/server/mail/templates";
import { generateRandomAvatar } from "@/server/media/avatars";
import { createNotifications } from "./notifications";
import { getAppSettings } from "./settings";

export type PublicUser = Pick<User, "id" | "name" | "bio" | "avatarMediaId" | "role" | "status" | "lastSeenAt" | "createdAt" | "isBot"> & { online: boolean };

const ONLINE_WINDOW = sql`interval '3 minutes'`;

export async function getUserByEmail(email: string): Promise<User | undefined> {
  return db.query.users.findFirst({ where: eq(users.email, email.toLowerCase().trim()) });
}

export async function getUserById(id: string): Promise<User | undefined> {
  return db.query.users.findFirst({ where: eq(users.id, id) });
}

export async function listAdmins(): Promise<User[]> {
  return db.query.users.findMany({ where: and(eq(users.role, "admin"), eq(users.status, "active")) });
}

export type RegisterInput = { email: string; name: string; locale: Locale; message?: string | null };
export type RegisterResult = { ok: true; status: User["status"] } | { ok: false; reason: "exists" };

/**
 * Registration creates a `pending` user with a generated avatar and notifies admins.
 * If the e-mail already exists we report `exists` (the UI shows a neutral message).
 */
export async function registerUser(input: RegisterInput): Promise<RegisterResult> {
  const email = input.email.toLowerCase().trim();
  const existing = await getUserByEmail(email);
  if (existing) return { ok: false, reason: "exists" };

  const id = crypto.randomUUID();
  const [user] = await db
    .insert(users)
    .values({
      id,
      email,
      name: input.name.trim().slice(0, 120),
      emailVerified: false,
      role: "member",
      status: "pending",
      locale: input.locale,
      registrationMessage: input.message?.trim().slice(0, 1000) || null,
    })
    .returning();

  try {
    const avatar = await generateRandomAvatar(id);
    await db.update(users).set({ avatarMediaId: avatar.id }).where(eq(users.id, id));
  } catch (err) {
    logger.error({ err, userId: id }, "avatar generation failed");
  }

  await db.insert(auditLog).values({ actorId: id, action: "user.registered", targetType: "user", targetId: id });

  // Notify admins in-app + by mail (best effort)
  try {
    const [admins, settings] = await Promise.all([listAdmins(), getAppSettings()]);
    await createNotifications(
      admins.map((a) => ({
        userId: a.id,
        type: "member.pending",
        title: a.locale === "en" ? `New registration: ${user.name}` : `Neue Registrierung: ${user.name}`,
        body: user.email,
        data: { href: "/admin/members?status=pending", userId: user.id },
      })),
    );
    await Promise.allSettled(
      admins.map((a) =>
        sendMail(pendingMemberAdminMail({ appName: settings.name, appUrl: env.APP_URL, locale: a.locale }, a.email, user)),
      ),
    );
  } catch (err) {
    logger.error({ err }, "admin notification for registration failed");
  }

  return { ok: true, status: user.status };
}

export async function approveUser(userId: string, actorId: string, sendLink: (email: string) => Promise<void>): Promise<User | undefined> {
  const [user] = await db
    .update(users)
    .set({ status: "active", approvedAt: new Date(), approvedBy: actorId })
    .where(and(eq(users.id, userId), ne(users.status, "active")))
    .returning();
  if (!user) return undefined;

  await db.insert(auditLog).values({ actorId, action: "user.approved", targetType: "user", targetId: userId });
  await createNotifications([
    {
      userId,
      type: "member.approved",
      title: user.locale === "en" ? "Your account has been approved" : "Dein Konto wurde freigeschaltet",
      data: { href: "/" },
    },
  ]);
  try {
    const settings = await getAppSettings();
    await sendMail(accountApprovedMail({ appName: settings.name, appUrl: env.APP_URL, locale: user.locale }, user.email, `${env.APP_URL}/login`));
    await sendLink(user.email);
  } catch (err) {
    logger.error({ err, userId }, "approval mail failed");
  }
  return user;
}

export async function setUserStatus(userId: string, status: User["status"], actorId: string): Promise<void> {
  await db.update(users).set({ status }).where(eq(users.id, userId));
  await db.insert(auditLog).values({ actorId, action: `user.status.${status}`, targetType: "user", targetId: userId });
}

export async function setUserRole(userId: string, role: User["role"], actorId: string): Promise<void> {
  await db.update(users).set({ role }).where(eq(users.id, userId));
  await db.insert(auditLog).values({ actorId, action: `user.role.${role}`, targetType: "user", targetId: userId });
}

export async function updateProfile(userId: string, patch: Partial<Pick<User, "name" | "bio" | "locale" | "avatarMediaId">>): Promise<User> {
  const [row] = await db.update(users).set(patch).where(eq(users.id, userId)).returning();
  return row;
}

export async function touchLastSeen(userId: string): Promise<void> {
  // Cheap write; throttled by caller (only if older than 60s).
  await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, userId));
}

export async function listUsers(opts: { status?: User["status"]; query?: string; limit?: number } = {}): Promise<User[]> {
  const conds = [eq(users.isBot, false)];
  if (opts.status) conds.push(eq(users.status, opts.status));
  if (opts.query) {
    const q = `%${opts.query.trim()}%`;
    conds.push(or(ilike(users.name, q), ilike(users.email, q))!);
  }
  return db.query.users.findMany({
    where: conds.length ? and(...conds) : undefined,
    orderBy: [desc(users.createdAt)],
    limit: opts.limit ?? 200,
  });
}

export async function listActiveMembers(query?: string): Promise<PublicUser[]> {
  const conds = [eq(users.status, "active"), eq(users.isBot, false)];
  if (query) conds.push(ilike(users.name, `%${query.trim()}%`));
  return db
    .select({
      id: users.id,
      name: users.name,
      bio: users.bio,
      avatarMediaId: users.avatarMediaId,
      role: users.role,
      status: users.status,
      lastSeenAt: users.lastSeenAt,
      createdAt: users.createdAt,
      isBot: users.isBot,
      online: sql<boolean>`coalesce(${users.lastSeenAt} > now() - ${ONLINE_WINDOW}, false)`,
    })
    .from(users)
    .where(and(...conds))
    .orderBy(asc(users.name));
}

export async function countUsersByStatus(): Promise<Record<User["status"], number>> {
  const rows = await db.select({ status: users.status, count: sql<number>`count(*)::int` }).from(users).where(eq(users.isBot, false)).groupBy(users.status);
  const out: Record<User["status"], number> = { pending: 0, active: 0, suspended: 0 };
  for (const r of rows) out[r.status] = r.count;
  return out;
}

export async function getPublicUser(id: string): Promise<PublicUser | undefined> {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      bio: users.bio,
      avatarMediaId: users.avatarMediaId,
      role: users.role,
      status: users.status,
      lastSeenAt: users.lastSeenAt,
      createdAt: users.createdAt,
      isBot: users.isBot,
      online: sql<boolean>`coalesce(${users.lastSeenAt} > now() - ${ONLINE_WINDOW}, false)`,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return rows[0];
}
