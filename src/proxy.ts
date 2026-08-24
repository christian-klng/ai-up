import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Lightweight routing gate: redirects visitors without a session cookie to /login.
 * Real authorization (active status, admin role) happens in layouts, server actions and route handlers
 * via requireUser()/requireAdmin() – never rely on this file alone.
 */
const PUBLIC_PREFIXES = ["/login", "/register", "/pending", "/api/auth", "/api/health", "/api/files", "/api/mcp", "/api/livekit", "/auth"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // "/" is public (landing page); the page itself redirects to /login or /home when the landing is disabled.
  if (pathname === "/" || PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }
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
