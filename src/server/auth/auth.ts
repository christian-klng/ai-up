import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins/magic-link";
import { handoff } from "./handoff-plugin";
import { handoffOrigins, isHandoffHost } from "./handoff-hosts";
import { db } from "@/server/db/client";
import { accounts, sessions, users, verifications } from "@/server/db/schema";
import { env } from "@/server/env";
import { hostOf } from "@/lib/community";
import { logger } from "@/server/logger";
import { sendMail } from "@/server/mail/mailer";
import { magicLinkMail } from "@/server/mail/templates";
import { getPublicCommunity } from "@/server/community-context";
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
  // With sub-domains on, a community's pages live on `<slug>.<app host>` and post back to the main
  // host, so those origins have to be trusted. One level only – the same shape the wildcard
  // certificate covers (docs/communities.md §7.4).
  /**
   * A function, not a list: a community on its own domain posts back from *that* origin, and which
   * domains exist is only known at runtime. Sub-domains are covered by one wildcard – `app.host`
   * keeps the port, which the origin of a request carries too, so a pattern without it would never
   * match in development (`http://*.localhost` vs `http://x.localhost:3000`).
   */
  trustedOrigins: async () => {
    const app = new URL(env.APP_URL);
    const origins = [env.APP_URL];
    if (env.COMMUNITY_SUBDOMAINS) origins.push(`${app.protocol}//*.${app.host}`);
    if (env.COMMUNITY_CUSTOM_DOMAINS) origins.push(...(await handoffOrigins()));
    return origins;
  },
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
    /**
     * One session across all community sub-domains: the magic link is verified on the main host, and
     * the cookie has to be valid on `<slug>.<app host>` too, or every switch would ask for a new
     * sign-in. The trade-off is that the cookie is also sent to any other sub-domain of the app host
     * (`meet.`, `coolify.`); they ignore it, and an own-domain community would use the hand-off
     * described in docs/communities.md §7.4 instead.
     */
    ...(env.COMMUNITY_SUBDOMAINS ? { crossSubDomainCookies: { enabled: true, domain: `.${hostOf(env.APP_URL)}` } } : {}),
  },
  plugins: [
    magicLink({
      disableSignUp: true,
      expiresIn: MAGIC_LINK_TTL_SECONDS,
      storeToken: "hashed",
      rateLimit: { window: 60, max: 5 },
      async sendMagicLink({ email, url }) {
        const user = await getUserByEmail(email);
        if (!user || user.status !== "active" || user.isBot) {
          // Never leak account state; just don't send anything.
          logger.warn({ email, status: user?.status ?? "unknown" }, "magic link requested for non-active account");
          return;
        }
        // No session here – this runs for a visitor typing their address. The community is the one
        // whose host the sign-in page was served under, so the mail carries the right name.
        // (`requireCommunity()` is a *page* guard and would redirect, which broke the send.)
        const community = await getPublicCommunity();
        await sendMail(magicLinkMail({ appName: community.name, appUrl: env.APP_URL, locale: user.locale }, email, url));
      },
    }),
    // Stage B (spike): lets a community on its own domain receive the session after signing in on
    // the main host. Off until the proxy can serve such a domain at all.
    ...(env.COMMUNITY_CUSTOM_DOMAINS ? [handoff({ isAllowedHost: isHandoffHost })] : []),
    nextCookies(),
  ],
});

export type Auth = typeof auth;
