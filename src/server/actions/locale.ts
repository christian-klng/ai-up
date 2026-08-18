"use server";

import { cookies } from "next/headers";
import { isLocale, LOCALE_COOKIE } from "@/i18n/config";
import { getCurrentUser } from "@/server/auth/session";
import { updateProfile } from "@/server/domain/users";

/** Sets the UI language (cookie) and, when signed in, persists it on the profile. */
export async function setLocale(locale: string): Promise<void> {
  if (!isLocale(locale)) return;
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: false,
  });
  const user = await getCurrentUser();
  if (user && user.locale !== locale) await updateProfile(user.id, { locale });
}
