import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { canonicalHostRedirect } from "@/lib/community";
import { isCustomPagePath } from "@/lib/site-pages";

/**
 * Lightweight routing gate: redirects visitors without a session cookie to /login.
 * Real authorization (active status, admin role) happens in layouts, server actions and route handlers
 * via requireUser()/requireAdmin() – never rely on this file alone.
 */
const PUBLIC_PREFIXES = ["/login", "/register", "/pending", "/invite", "/join", "/c", "/imprint", "/privacy", "/api/auth", "/api/health", "/api/files", "/api/mcp", "/api/livekit", "/api/internal", "/api/domains", "/auth"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // `www.` would be a second cookie jar in which nobody is ever signed in: send it to the app host.
  // The Host header, not request.url – that one carries the configured origin, not the requested host.
  // Next shortens a redirect to a relative path when its host equals the server's own (`nextUrl` –
  // in production `0.0.0.0:3000`, behind Traefik), which the browser would resolve against `www.`
  // again: a loop. That only happens when the server listens on the app host itself, as `next dev`
  // on localhost does; there the alias is left alone.
  const canonical = canonicalHostRedirect(request.headers.get("host"), process.env.APP_URL ?? "");
  if (canonical && new URL(canonical).host !== request.nextUrl.host) {
    return NextResponse.redirect(`${canonical}${pathname}${request.nextUrl.search}`, 308);
  }
  // "/" is public (landing page); the page itself redirects to /login or /home when the landing is disabled.
  if (pathname === "/" || PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }
  // Custom pages ("/blog") and their posts ("/blog/<post>"): every one- or two-segment path whose
  // first segment is not taken by the app. Whether the page exists decides the route (404 otherwise).
  if (isCustomPagePath(pathname)) return NextResponse.next();
  const cookie = getSessionCookie(request);
  if (!cookie) {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Skip static assets and the upload endpoint (large bodies must not be buffered by the proxy).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|api/upload|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)"],
};
