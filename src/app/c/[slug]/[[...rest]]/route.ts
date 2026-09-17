import { NextResponse, type NextRequest } from "next/server";
import { COMMUNITY_COOKIE, COMMUNITY_COOKIE_OPTIONS } from "@/lib/community";
import { getAccount } from "@/server/auth/session";
import { getCommunityBySlug, getMembership } from "@/server/domain/communities";
import { primaryHostOf } from "@/server/domain/community-domains";

export const dynamic = "force-dynamic";

/**
 * Shareable links into a specific community: `/c/<slug>/knowledge/buecher` points the active
 * community at `<slug>` and forwards to `/knowledge/buecher`.
 *
 * This is what makes a link survive being pasted into a chat while the recipient happens to be in
 * another community. It is a route handler because only one can write the cookie, and it is a
 * redirect rather than a real route prefix so every existing href, deep link and bookmark in the
 * app keeps working untouched (see docs/communities.md §3).
 *
 * Not a member (or signed out)? Forward to the target anyway: the page's own guard decides, and a
 * signed-out visitor lands on the sign-in page with the right destination.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/c/[slug]/[[...rest]]">) {
  const { slug, rest } = await ctx.params;
  const path = `/${(rest ?? []).map(encodeURIComponent).join("/")}`.replace(/^\/$/, "/home");
  const target = new URL(path + req.nextUrl.search, req.url);

  const community = await getCommunityBySlug(slug);
  if (!community) return NextResponse.redirect(new URL("/home", req.url));

  // A community with its own domain is reached there, not through the prefix: the hand-off carries
  // the session across, because a cookie does not cross a registrable domain.
  const own = await primaryHostOf(community.id);
  if (own) {
    const handoff = new URL("/auth/handoff", req.url);
    handoff.searchParams.set("to", own);
    handoff.searchParams.set("next", path + req.nextUrl.search);
    return NextResponse.redirect(handoff);
  }

  const res = NextResponse.redirect(target);
  const account = await getAccount();
  if (account) {
    const membership = await getMembership(community.id, account.id);
    if (membership?.status === "active") res.cookies.set(COMMUNITY_COOKIE, community.id, COMMUNITY_COOKIE_OPTIONS);
  }
  return res;
}
