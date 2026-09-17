import { NextResponse, type NextRequest } from "next/server";
import { COMMUNITY_COOKIE, COMMUNITY_COOKIE_OPTIONS } from "@/lib/community";
import { getAccount } from "@/server/auth/session";
import { getMembership } from "@/server/domain/communities";
import { resolveCommunityInvite } from "@/server/domain/community-invites";

export const dynamic = "force-dynamic";

/**
 * Sends an existing member of the invited community into it: sets the active-community cookie and
 * forwards to the app home. A route handler rather than the page itself, because a server component
 * cannot write cookies – and landing on the app with the previous community still selected would be
 * exactly the confusing part.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/join/[token]/open">) {
  const { token } = await ctx.params;
  const resolved = await resolveCommunityInvite(token);
  const account = await getAccount();
  if (!resolved || !account || account.status !== "active") {
    return NextResponse.redirect(new URL(`/join/${encodeURIComponent(token)}`, req.url));
  }
  const membership = await getMembership(resolved.community.id, account.id);
  if (membership?.status !== "active") {
    return NextResponse.redirect(new URL(`/join/${encodeURIComponent(token)}`, req.url));
  }
  const res = NextResponse.redirect(new URL("/home", req.url));
  res.cookies.set(COMMUNITY_COOKIE, resolved.community.id, COMMUNITY_COOKIE_OPTIONS);
  return res;
}
