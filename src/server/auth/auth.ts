import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins/magic-link";
import { db } from "@/server/db/client";
import { accounts, sessions, users, verifications } from "@/server/db/schema";
import { env } from "@/server/env";
import { logger } from "@/server/logger";
import { sendMail } from "@/server/mail/mailer";
import { magicLinkMail } from "@/server/mail/templates";
import { getAppSettings } from "@/server/domain/settings";
import { getUserByEmail } from "@/server/domain/users";

export const MAGIC_LINK_TTL_SECONDS = 60 * 15;

/**
 * Better Auth instance.
 * - Magic link is the only sign-in method.
 * - Sign-up through the magic link endpoint is disabled: registration is a separate flow
 *   that creates a `pending` user; only `active` users receive links (checked in the login action
 *   and defensively again here).
 */
export const auth = betterAuth({
  appName: "AI-Up",
  baseURL: env.APP_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.APP_URL],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user: users, session: sessions, account: accounts, verification: verifications },
  }),
  emailAndPassword: { enabled: false },
  user: {
    additionalFields: {
      role: { type: "string", input: false, defaultValue: "member" },
      status: { type: "string", input: false, defaultValue: "pending" },
      locale: { type: "string", input: false, defaultValue: env.DEFAULT_LOCALE },
      bio: { type: "string", input: false, required: false },
      avatarMediaId: { type: "string", input: false, required: false },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // refresh once per day
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  advanced: {
    database: { generateId: () => crypto.randomUUID() },
    useSecureCookies: env.APP_URL.startsWith("https://"),
  },
  plugins: [
    magicLink({
      disableSignUp: true,
      expiresIn: MAGIC_LINK_TTL_SECONDS,
      storeToken: "hashed",
      rateLimit: { window: 60, max: 5 },
      async sendMagicLink({ email, url }) {
        const user = await getUserByEmail(email);
        if (!user || user.status !== "active") {
          // Never leak account state; just don't send anything.
          logger.warn({ email, status: user?.status ?? "unknown" }, "magic link requested for non-active account");
          return;
        }
        const settings = await getAppSettings();
        await sendMail(magicLinkMail({ appName: settings.name, appUrl: env.APP_URL, locale: user.locale }, email, url));
      },
    }),
    nextCookies(),
  ],
});

export type Auth = typeof auth;
