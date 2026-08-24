"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { auth } from "@/server/auth/auth";
import { getUserByEmail, registerUser } from "@/server/domain/users";
import { isLocale } from "@/i18n/config";
import { logger } from "@/server/logger";

export type AuthFormState =
  | { status: "idle" }
  | { status: "sent"; email: string }
  | { status: "registered" }
  | { status: "error"; code: "invalidEmail" | "nameRequired" | "tooManyRequests" | "unexpected" };

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

export async function signOut(): Promise<void> {
  await auth.api.signOut({ headers: await headers() });
  redirect("/login");
}
