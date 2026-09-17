import "server-only";
import { headers } from "next/headers";
import { cache } from "react";
import { hostOf, subdomainSlug } from "@/lib/community";
import { getCommunityBySlug, getRootCommunity, loadCommunity } from "@/server/domain/communities";
import { communityIdForHost } from "@/server/domain/community-domains";
import { env } from "@/server/env";
import { logger } from "@/server/logger";
import type { Community } from "@/server/db/schema";

/**
 * Resolving the community from the request host.
 *
 * Its own module rather than part of `auth/session.ts` because the auth configuration needs it too
 * (the magic-link mail carries the community's name) and importing the session module from there
 * would close a cycle: session imports `auth`, auth would import session.
 */

let warnedAboutLocalhost = false;

/**
 * The community the request host names, or null on the main host.
 *
 * Two ways a host can name one: a verified entry in `community_domains` (stage B) or, when
 * sub-domains are switched on, the slug in front of the app host (stage A). Neither is consulted
 * while its feature is off – without wildcard DNS or a certificate such a host could not be reached
 * at all, and treating an arbitrary Host header as meaningful would invite spoofing. The host is
 * never used to *build* a URL – only to look a community up.
 */
export const getHostCommunity = cache(async (): Promise<Community | null> => {
  const host = (await headers()).get("host");

  // A community's own domain wins over the sub-domain scheme: it is an exact, verified match,
  // while the sub-domain rule is a pattern. Both only ever *look a community up* – neither builds
  // a URL from the header, so a forged Host cannot redirect anyone (docs/communities.md §7.3).
  const byDomain = await communityIdForHost(host);
  if (byDomain) {
    const community = await loadCommunity(byDomain);
    // A deleted community keeps its rows until the purge – its domain must stop answering at once.
    return community && !community.deletedAt ? community : null;
  }

  if (!env.COMMUNITY_SUBDOMAINS) return null;
  // Browsers refuse a cookie with `Domain=.localhost` (localhost is a public suffix), so the shared
  // session across sub-domains cannot work there. Branding and routing do – which is exactly what
  // makes this confusing without a word of warning.
  if (!warnedAboutLocalhost && hostOf(env.APP_URL).split(".").length < 2) {
    warnedAboutLocalhost = true;
    logger.warn(
      { appUrl: env.APP_URL },
      "COMMUNITY_SUBDOMAINS is on for a single-label host: sub-domain branding works, but the browser will not share the session cookie. Use a real domain (or an /etc/hosts entry like aiup.test) to try the full flow.",
    );
  }
  const slug = subdomainSlug(host, hostOf(env.APP_URL));
  if (!slug) return null;
  return (await getCommunityBySlug(slug)) ?? null;
});

/**
 * The community a page shows to someone without a session: the one the host names, otherwise the
 * root, which owns the main host. Used by the sign-in frame, the landing pages, invite pages and
 * the magic-link mail.
 */
export async function getPublicCommunity(): Promise<Community> {
  return (await getHostCommunity()) ?? (await getRootCommunity());
}
