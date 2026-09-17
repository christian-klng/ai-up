import { NextResponse, type NextRequest } from "next/server";
import { normalizeHost } from "@/lib/community";
import { isHandoffHost } from "@/server/auth/handoff-hosts";
import { env } from "@/server/env";
import { getRedis } from "@/server/redis";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

/**
 * The "ask" endpoint of Caddy's on-demand TLS: before obtaining a certificate for a host it has
 * never seen, the proxy asks here whether that host belongs to us. 200 = go ahead, anything else =
 * refuse (docs/communities.md §7.5).
 *
 * Without it anyone could point a domain at the server and make it request certificates in our
 * name, which would exhaust Let's Encrypt's rate limits within minutes.
 *
 * **This runs inside the TLS handshake**, so it has to be fast and must not touch the database on
 * the hot path: the answer is cached in Redis, and a cache miss falls back to the lookup once.
 * It is meant for the proxy on the internal network, not for the public internet.
 *
 * It answers yes only for a **verified** domain, so pointing a domain at the server proves nothing
 * on its own – the DNS check in `domain/community-domains.ts` has to have succeeded first.
 */

const CACHE_TTL_SECONDS = 300;
const cacheKey = (host: string) => `aiup:domain-ok:${host}`;

export async function GET(req: NextRequest) {
  if (!env.COMMUNITY_CUSTOM_DOMAINS) return new NextResponse("custom domains are off", { status: 404 });

  const host = normalizeHost(req.nextUrl.searchParams.get("domain"));
  if (!host) return new NextResponse("missing domain", { status: 400 });

  try {
    const cached = await getRedis().get(cacheKey(host));
    if (cached === "1") return new NextResponse("ok", { status: 200 });
    if (cached === "0") return new NextResponse("unknown host", { status: 403 });
  } catch (err) {
    // No cache is survivable; being unable to answer at all is not.
    logger.warn({ err, host }, "domain check: cache unavailable");
  }

  const allowed = await isHandoffHost(host);
  try {
    await getRedis().set(cacheKey(host), allowed ? "1" : "0", "EX", CACHE_TTL_SECONDS);
  } catch {
    /* best effort */
  }
  if (!allowed) logger.info({ host }, "domain check: refused a certificate request");
  return new NextResponse(allowed ? "ok" : "unknown host", { status: allowed ? 200 : 403 });
}
