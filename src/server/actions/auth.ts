"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { auth } from "@/server/auth/auth";
import { getAccount } from "@/server/auth/session";
import { COMMUNITY_COOKIE, COMMUNITY_COOKIE_OPTIONS } from "@/lib/community";
import { ROOT_COMMUNITY_ID } from "@/server/domain/communities";
import { joinViaCommunityInvite, resolveCommunityInvite } from "@/server/domain/community-invites";
import { joinViaMeetingInvite, resolveInvite } from "@/server/domain/invites";
import { getUserByEmail, registerUser } from "@/server/domain/users";
import { isLocale } from "@/i18n/config";
import { logger } from "@/server/logger";

export type AuthFormState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "registered" }
  | { status: "error"; code: "invalidEmail" | "nameRequired" | "tooManyRequests" | "invalidInvite" | "unexpected" };

const emailSchema = z.string().trim().toLowerCase().email();

/** Requests a magic link. Always answers "sent" for well-formed e-mails to avoid account enumeration. */
export async function requestMagicLink(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = emailSchema.safeParse(formData.get("email"));
  if (!email.success) return { status: "error", code: "invalidEmail" };
  const next = typeof formData.get("next") === "string" ? String(formData.get("next")) : "/home";
  const callbackURL = next.startsWith("/") && !next.startsWith("//") ? next : "/home";

  try {
    const user = await getUserByEmail(email.data);
    if (user && user.status === "active") {
      await auth.api.signInMagicLink({
        headers: await headers(),
        body: { email: email.data, callbackURL, errorCallbackURL: "/login?error=invalid_link" },
      });
    } else {
      logger.info({ email: email.data, status: user?.status ?? "none" }, "magic link not sent (no active account)");
    }
  } catch (err) {
    const status = (err as { status?: number | string })?.status;
    if (status === 429 || status === "TOO_MANY_REQUESTS") return { status: "error", code: "tooManyRequests" };
    logger.error({ err }, "magic link request failed");
    return { status: "error", code: "unexpected" };
  }
  return { status: "sent", email: email.data };
}

const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
  message: z.string().trim().max(1000).optional(),
});

export async function register(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    message: formData.get("message") || undefined,
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return { status: "error", code: field === "name" ? "nameRequired" : "invalidEmail" };
  }
  const localeRaw = await getLocale();
  const locale = isLocale(localeRaw) ? localeRaw : "de";
  try {
    // Existing accounts get the same neutral confirmation (no enumeration).
    // The public form always registers into the root community; sub-communities use their own
    // link or /c/<slug>/register (phase C).
    await registerUser({ ...parsed.data, communityId: ROOT_COMMUNITY_ID, locale });
  } catch (err) {
    logger.error({ err }, "registration failed");
    return { status: "error", code: "unexpected" };
  }
  return { status: "registered" };
}

const inviteSchema = z.object({
  token: z.string().trim().min(8).max(64),
  name: z.string().trim().min(2).max(120),
  email: emailSchema,
});

/**
 * Registration through a meeting invite link: the account is created active and receives a magic
 * link that lands on the meeting page. Existing active members get the same link; pending or
 * suspended accounts get nothing – the confirmation is identical either way (no enumeration).
 */
export async function registerViaInvite(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = inviteSchema.safeParse({ token: formData.get("token"), name: formData.get("name"), email: formData.get("email") });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return { status: "error", code: field === "name" ? "nameRequired" : field === "email" ? "invalidEmail" : "invalidInvite" };
  }
  const resolved = await resolveInvite(parsed.data.token);
  if (!resolved) return { status: "error", code: "invalidInvite" };
  const localeRaw = await getLocale();
  const locale = isLocale(localeRaw) ? localeRaw : "de";

  try {
    const result = await registerUser({
      communityId: resolved.communityId,
      name: parsed.data.name,
      email: parsed.data.email,
      locale,
      invite: {
        id: resolved.invite.id,
        createdBy: resolved.invite.createdBy,
        meetingId: resolved.meeting.id,
        meetingTitle: resolved.meeting.title,
        meetingHref: resolved.href,
      },
    });
    if (result.user.status === "active" && !result.user.isBot) {
      await auth.api.signInMagicLink({
        headers: await headers(),
        body: { email: parsed.data.email, callbackURL: resolved.href, errorCallbackURL: `/login?error=invalid_link&next=${encodeURIComponent(resolved.href)}` },
      });
    } else {
      logger.info({ email: parsed.data.email, status: result.user.status, inviteId: resolved.invite.id }, "invite registration without magic link (account not active)");
    }
  } catch (err) {
    const status = (err as { status?: number | string })?.status;
    if (status === 429 || status === "TOO_MANY_REQUESTS") return { status: "error", code: "tooManyRequests" };
    logger.error({ err, inviteId: resolved.invite.id }, "invite registration failed");
    return { status: "error", code: "unexpected" };
  }
  return { status: "sent", email: parsed.data.email };
}

export async function signOut(): Promise<void> {
  await auth.api.signOut({ headers: await headers() });
  redirect("/login");
}

/**
 * Registration through a community's join link: the account is created active and receives a magic
 * link that lands on the app home of that community. Existing active accounts get the same link;
 * the confirmation is identical either way (no enumeration).
 */
export async function registerViaJoinLink(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = inviteSchema.safeParse({ token: formData.get("token"), name: formData.get("name"), email: formData.get("email") });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return { status: "error", code: field === "name" ? "nameRequired" : field === "email" ? "invalidEmail" : "invalidInvite" };
  }
  const resolved = await resolveCommunityInvite(parsed.data.token);
  if (!resolved) return { status: "error", code: "invalidInvite" };
  const localeRaw = await getLocale();
  const locale = isLocale(localeRaw) ? localeRaw : "de";
  // After signing in the cookie must point at the community they just joined, not at whichever one
  // they happened to be in before – /join/<token> sets it and forwards.
  const target = `/join/${parsed.data.token}`;

  try {
    const result = await registerUser({
      communityId: resolved.community.id,
      name: parsed.data.name,
      email: parsed.data.email,
      locale,
      joinLink: { id: resolved.invite.id, approvedBy: resolved.invite.createdBy },
    });
    if (result.user.status === "active" && !result.user.isBot) {
      await auth.api.signInMagicLink({
        headers: await headers(),
        body: { email: parsed.data.email, callbackURL: target, errorCallbackURL: `/login?error=invalid_link&next=${encodeURIComponent(target)}` },
      });
    } else {
      logger.info({ email: parsed.data.email, status: result.user.status }, "join-link registration without magic link (account not active)");
    }
  } catch (err) {
    const status = (err as { status?: number | string })?.status;
    if (status === 429 || status === "TOO_MANY_REQUESTS") return { status: "error", code: "tooManyRequests" };
    logger.error({ err, inviteId: resolved.invite.id }, "join-link registration failed");
    return { status: "error", code: "unexpected" };
  }
  return { status: "sent", email: parsed.data.email };
}

/** Lets the signed-in account join through the link and switches the active community to it. */
export async function joinCommunityAction(token: string): Promise<{ ok: true; slug: string } | { ok: false; reason: "invalid" | "suspended" | "unauthenticated" }> {
  const account = await getAccount();
  if (!account || account.status !== "active") return { ok: false, reason: "unauthenticated" };
  const resolved = await resolveCommunityInvite(token);
  if (!resolved) return { ok: false, reason: "invalid" };
  const res = await joinViaCommunityInvite(token, account.id);
  if (!res.ok) return res;
  (await cookies()).set(COMMUNITY_COOKIE, resolved.community.id, COMMUNITY_COOKIE_OPTIONS);
  revalidatePath("/", "layout");
  return { ok: true, slug: resolved.community.slug };
}

/** Lets the signed-in account join the meeting's community and switches the active community to it. */
export async function joinViaMeetingInviteAction(token: string): Promise<{ ok: true; href: string } | { ok: false; reason: "invalid" | "suspended" | "unauthenticated" }> {
  const account = await getAccount();
  if (!account || account.status !== "active") return { ok: false, reason: "unauthenticated" };
  const res = await joinViaMeetingInvite(token, account.id);
  if (!res.ok) return res;
  const resolved = await resolveInvite(token);
  if (resolved) (await cookies()).set(COMMUNITY_COOKIE, resolved.communityId, COMMUNITY_COOKIE_OPTIONS);
  revalidatePath("/", "layout");
  return { ok: true, href: res.href };
}
