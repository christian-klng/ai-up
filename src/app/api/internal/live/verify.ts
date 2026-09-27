import { env } from "@/server/env";
import { LISTENER_SIGNATURE_HEADER, LISTENER_TIMESTAMP_HEADER, verifyListenerRequest } from "@/lib/live-listener";

/**
 * Checks the listener's HMAC signature. The signed path is the one the listener requested (path + query),
 * taken from the URL rather than a Host-dependent absolute form.
 */
export function verifyListener(req: Request, body: string): Response | null {
  if (!env.LISTENER_SHARED_SECRET) return new Response("live listener not configured", { status: 503 });
  const url = new URL(req.url);
  const ok = verifyListenerRequest(env.LISTENER_SHARED_SECRET, {
    method: req.method,
    path: url.pathname + url.search,
    timestamp: req.headers.get(LISTENER_TIMESTAMP_HEADER),
    signature: req.headers.get(LISTENER_SIGNATURE_HEADER),
    body,
  });
  return ok ? null : new Response("unauthorized", { status: 401 });
}
