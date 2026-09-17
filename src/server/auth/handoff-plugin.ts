import { randomBytes } from "node:crypto";
import { z } from "zod";
import { APIError, createAuthEndpoint, getSessionFromCtx } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import type { BetterAuthPlugin } from "better-auth";
import { getRedis } from "@/server/redis";
import { logger } from "@/server/logger";

/**
 * Session hand-off between hosts that cannot share a cookie.
 *
 * **Why this exists.** Communities on a sub-domain of the app host share the session through
 * `crossSubDomainCookies`. A community on its *own* domain cannot: a cookie never crosses a
 * registrable domain, and Better Auth's dynamic `baseURL.allowedHosts` is a static array, so an
 * arbitrary customer domain cannot simply be added at runtime either. The way across is to sign in
 * on the main host as usual and then hand the session over once (docs/communities.md §7.4).
 *
 * **How.** `/handoff/start` mints a single-use token for the signed-in account and remembers, in
 * Redis, which host may redeem it. `/handoff/consume` on the target host redeems it, creates a
 * *fresh* session for that account and sets the cookie there.
 *
 * A separate session on purpose, rather than copying the token: each host then has its own row, so
 * signing out on a community domain ends that session and leaves the main host alone – which is
 * what people expect from two different addresses.
 *
 * Wired up only when custom domains are switched on; the two routes that drive it are
 * `src/app/(public)/auth/handoff/`.
 */

/** Short on purpose: the token travels in a URL and is redeemed by the very next request. */
const TOKEN_TTL_SECONDS = 60;
const key = (token: string) => `aiup:handoff:${token}`;

export type HandoffPayload = { userId: string; host: string };

/**
 * Redeeming is atomic – `GETDEL` makes a replayed URL (browser history, a shared link, a proxy log)
 * worthless after the first use.
 */
async function takeToken(token: string): Promise<HandoffPayload | null> {
  try {
    const raw = await getRedis().getdel(key(token));
    return raw ? (JSON.parse(raw) as HandoffPayload) : null;
  } catch (err) {
    logger.error({ err }, "handoff: could not read the token");
    return null;
  }
}

export type HandoffOptions = {
  /**
   * Is this host allowed to receive a session? Answered from the verified rows in
   * `community_domains`. Never let this default to true – the host decides where a session lands.
   */
  isAllowedHost: (host: string) => Promise<boolean> | boolean;
};

export function handoff(options: HandoffOptions) {
  return {
    id: "aiup-handoff",
    endpoints: {
      /**
       * Main host, signed in: mint a token for `host`. The caller redirects the browser to
       * `https://<host>/auth/handoff/<token>`, which calls `consume` below.
       */
      handoffStart: createAuthEndpoint(
        "/handoff/start",
        { method: "POST", body: z.object({ host: z.string().trim().min(3).max(253) }) },
        async (ctx) => {
          const session = await getSessionFromCtx(ctx);
          if (!session?.user) throw new APIError("UNAUTHORIZED", { message: "sign in first" });
          const host = ctx.body.host.toLowerCase();
          if (!(await options.isAllowedHost(host))) throw new APIError("BAD_REQUEST", { message: "unknown host" });

          const token = randomBytes(32).toString("base64url");
          await getRedis().set(key(token), JSON.stringify({ userId: session.user.id, host } satisfies HandoffPayload), "EX", TOKEN_TTL_SECONDS);
          return ctx.json({ token, expiresIn: TOKEN_TTL_SECONDS });
        },
      ),

      /**
       * Target host: redeem the token and start a session here. The request must arrive *at* the
       * host the token was minted for – otherwise a token leaked from one community's domain could
       * be redeemed on another.
       */
      handoffConsume: createAuthEndpoint(
        "/handoff/consume",
        { method: "POST", body: z.object({ token: z.string().trim().min(10).max(200) }) },
        async (ctx) => {
          const payload = await takeToken(ctx.body.token);
          if (!payload) throw new APIError("BAD_REQUEST", { message: "this link is no longer valid" });

          const requestHost = (ctx.headers?.get("host") ?? "").split(":")[0]!.toLowerCase();
          if (requestHost !== payload.host) {
            logger.warn({ expected: payload.host, actual: requestHost }, "handoff: token redeemed on the wrong host");
            throw new APIError("BAD_REQUEST", { message: "this link is no longer valid" });
          }

          const user = await ctx.context.internalAdapter.findUserById(payload.userId);
          if (!user) throw new APIError("BAD_REQUEST", { message: "this link is no longer valid" });

          const session = await ctx.context.internalAdapter.createSession(user.id, false);
          if (!session) throw new APIError("INTERNAL_SERVER_ERROR", { message: "could not start the session" });
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ status: true });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
