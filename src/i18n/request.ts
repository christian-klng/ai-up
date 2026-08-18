import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { defaultLocale, isLocale, LOCALE_COOKIE, type Locale } from "./config";

/**
 * Locale resolution (no locale prefix in URLs):
 *  1. explicit locale passed to getTranslations({locale})
 *  2. cookie `aiup_locale` (set from the user's profile or the language switcher)
 *  3. Accept-Language header
 *  4. default locale
 */
export default getRequestConfig(async ({ locale: explicit }) => {
  let locale: Locale = defaultLocale;

  if (isLocale(explicit)) {
    locale = explicit;
  } else {
    const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
    if (isLocale(cookieLocale)) {
      locale = cookieLocale;
    } else {
      const accept = (await headers()).get("accept-language") ?? "";
      const preferred = accept
        .split(",")
        .map((p) => p.split(";")[0]?.trim().slice(0, 2).toLowerCase())
        .find(isLocale);
      if (preferred) locale = preferred;
    }
  }

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    timeZone: process.env.APP_TIMEZONE ?? "Europe/Berlin",
  };
});
