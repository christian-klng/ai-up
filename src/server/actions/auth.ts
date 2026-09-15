"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { auth } from "@/server/auth/auth";
import { resolveInvite } from "@/server/domain/invites";
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
    await registerUser({ ...parsed.data, locale });
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
