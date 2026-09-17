import { type NextRequest } from "next/server";
import { headers } from "next/headers";
import { auth } from "@/server/auth/auth";
import { env } from "@/server/env";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

/**
 * Step two, on the community's own domain: redeem the token and start a session here.
 *
 * The cookie is set by Better Auth's own endpoint – `asResponse` hands back the `Set-Cookie` it
 * built, which is copied onto the redirect. Signing a cookie by hand would tie us to a version of
 * its format.
 *
 * A failed redemption (expired, already used, wrong host) is not an error page: the visitor lands on
 * the sign-in form of this host, which is where they would have to go anyway.
 *
 * Every redirect here is **relative**. `NextRequest.url` carries the app's own origin rather than
 * the host the request arrived at, so building an absolute URL from it would send the visitor back
 * to the main domain – exactly the journey this route exists to end. The browser resolves a relative
 * `Location` against the address it asked for, which is the community's domain.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const raw = req.nextUrl.searchParams.get("next") ?? "/home";
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/home";
  if (!env.COMMUNITY_CUSTOM_DOMAINS) return redirectHere("/login");

  let consumed: Response;
  try {
    consumed = await auth.api.handoffConsume({ body: { token }, headers: await headers(), asResponse: true });
  } catch (err) {
    logger.warn({ err }, "handoff: redeeming failed");
    return redirectHere("/login");
  }
  if (!consumed.ok) return redirectHere("/login");

  const res = redirectHere(next);
  for (const cookie of consumed.headers.getSetCookie()) res.headers.append("set-cookie", cookie);
  return res;
}

/** A redirect that stays on whatever host the browser asked for. */
function redirectHere(path: string): Response {
  return new Response(null, { status: 303, headers: { location: path } });
}
