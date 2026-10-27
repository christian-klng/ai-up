import type { NextRequest } from "next/server";
import { COMMUNITY_COOKIE, COMMUNITY_COOKIE_OPTIONS } from "@/lib/community";
import { getAccount } from "@/server/auth/session";
import { getMembership } from "@/server/domain/communities";
import { resolveInvite } from "@/server/domain/invites";
import { redirectHere } from "@/server/redirect-here";

export const dynamic = "force-dynamic";

/**
 * Sends a member of the meeting's community to that meeting, with the active-community cookie
 * pointed at it. Without this step someone signed in with another community would land on the
 * meeting page as a stranger and see a 404.
 */
export async function GET(_req: NextRequest, ctx: RouteContext<"/invite/[token]/open">) {
  const { token } = await ctx.params;
  const back = `/invite/${encodeURIComponent(token)}`;
  const resolved = await resolveInvite(token);
  const account = await getAccount();
  if (!resolved || !account || account.status !== "active") return redirectHere(back);

  const membership = await getMembership(resolved.communityId, account.id);
  if (membership?.status !== "active") return redirectHere(back);

  const res = redirectHere(resolved.href);
  res.cookies.set(COMMUNITY_COOKIE, resolved.communityId, COMMUNITY_COOKIE_OPTIONS);
  return res;
}
