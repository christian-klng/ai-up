import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { normalizeHost } from "@/lib/community";
import { auth } from "@/server/auth/auth";
import { getAccount } from "@/server/auth/session";
import { communityIdForHost } from "@/server/domain/community-domains";
import { getMembership } from "@/server/domain/communities";
import { env } from "@/server/env";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

/**
 * Step one of the session hand-off, on the main host: mint a one-time token for a community's own
 * domain and send the browser there (docs/communities.md §7.4).
 *
 * A route handler rather than a page because nothing is rendered – it exists to redirect, and the
 * token must never sit in a page that could be cached or reloaded.
 */
export async function GET(req: NextRequest) {
  if (!env.COMMUNITY_CUSTOM_DOMAINS) return redirectHere("/home");

  const to = normalizeHost(req.nextUrl.searchParams.get("to"));
  // Only ever a path inside the app: `//evil.example` would be read as a host by the browser, and
  // this URL is one a stranger can hand someone.
  const raw = req.nextUrl.searchParams.get("next") ?? "/home";
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/home";

  const account = await getAccount();
  if (!account) {
    const back = `/auth/handoff?to=${encodeURIComponent(to)}&next=${encodeURIComponent(next)}`;
    return redirectHere(`/login?next=${encodeURIComponent(back)}`);
  }

  // The host has to be a verified domain, and the account has to belong to the community behind it.
  // Otherwise this would hand a session to a community someone has no business being signed in to.
  const communityId = await communityIdForHost(to);
  if (!communityId) return redirectHere("/home");
  const membership = await getMembership(communityId, account.id);
  if (!membership || membership.status !== "active") return redirectHere("/home");

  try {
    const { token } = await auth.api.handoffStart({ body: { host: to }, headers: await headers() });
    const app = new URL(env.APP_URL);
    const target = new URL(`${app.protocol}//${to}${app.port ? `:${app.port}` : ""}/auth/handoff/${token}`);
    target.searchParams.set("next", next);
    return NextResponse.redirect(target);
  } catch (err) {
    logger.error({ err, host: to }, "handoff: could not mint a token");
    return redirectHere("/home");
  }
}

/**
 * A redirect that stays on whatever host the browser asked for. `NextRequest.url` carries the app's
 * configured origin, not the requested host, so an absolute URL built from it would move the visitor
 * to the main domain whenever this runs on a community's own one.
 */
function redirectHere(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}
