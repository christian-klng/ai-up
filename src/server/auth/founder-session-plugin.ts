import { randomBytes } from "node:crypto";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import { getRedis } from "@/server/redis";

/**
 * Signs in someone who just confirmed a community request from the mail: the click proved the
 * address, so a second mail with a magic link would only be in the way.
 *
 * Every plugin endpoint is reachable over HTTP as well, which is why it takes a one-time token
 * rather than a user id – same shape as the hand-off (`handoff-plugin.ts`), which is only wired up
 * while custom domains are on. The cookie comes from Better Auth itself instead of being signed by
 * hand, and `nextCookies()` carries it out of the server action.
 */

const TOKEN_TTL_SECONDS = 60;
const key = (token: string) => `aiup:founder-session:${token}`;

export async function issueFounderSessionToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await getRedis().set(key(token), userId, "EX", TOKEN_TTL_SECONDS);
  return token;
}

export function founderSession() {
  return {
    id: "aiup-founder-session",
    endpoints: {
      founderSessionConsume: createAuthEndpoint(
        "/founder-session/consume",
        { method: "POST", body: z.object({ token: z.string().trim().min(10).max(200) }) },
        async (ctx) => {
          const userId = await getRedis().getdel(key(ctx.body.token));
          if (!userId) throw new APIError("BAD_REQUEST", { message: "this link is no longer valid" });
          const user = await ctx.context.internalAdapter.findUserById(userId);
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
