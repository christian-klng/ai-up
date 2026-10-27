import { NextResponse } from "next/server";

/**
 * A redirect that stays on whatever host the browser asked for – for route handlers only.
 *
 * `NextRequest.url` does not carry the requested host: behind the proxy it is the address the server
 * listens on (in production `https://0.0.0.0:3000`), and on a community's own domain it would be the
 * main host. An absolute URL built from it (`new URL(path, req.url)`) sends the browser there, so every
 * redirect to a path of this app goes out as a relative `Location`. Returns a `NextResponse`, so callers
 * can still set cookies on it.
 */
export function redirectHere(path: string, status: 303 | 307 = 307): NextResponse {
  return new NextResponse(null, { status, headers: { location: path } });
}
