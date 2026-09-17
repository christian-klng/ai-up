/**
 * Community constants shared by server and client (no imports from next/* or the database, so
 * client components and the worker can use them too).
 */

/** Cookie holding the community the user is currently acting in (main domain only). */
export const COMMUNITY_COOKIE = "aiup_community";

/**
 * A year, like the locale cookie: the choice is a convenience, and it is validated against the
 * account's memberships on every request anyway (see auth/session.ts).
 */
export const COMMUNITY_COOKIE_OPTIONS = { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" as const };

/** The installation's own community; mirrors ROOT_COMMUNITY_ID in the database schema. */
export const ROOT_COMMUNITY_SLUG = "default";

/**
 * An app-relative path that lands in a specific community, for links that leave the app and come
 * back later (mails, notifications shared between communities).
 *
 * The root community owns the plain paths, so its links stay exactly as they were. Every other
 * community gets the `/c/<slug>` prefix, which points the active community at it and then forwards
 * to the real page (see src/app/c/[slug]). Once a community has its own domain the prefix becomes
 * unnecessary for it (phase C2).
 */
export function communityPath(slug: string, path = "/home"): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return slug === ROOT_COMMUNITY_SLUG ? clean : `/c/${slug}${clean === "/" ? "" : clean}`;
}

/**
 * Host labels that must never become a community slug: they are real DNS names today or would be
 * confusing as one. Checked when a slug is chosen, because the slug doubles as the sub-domain label.
 */
export const RESERVED_COMMUNITY_SLUGS = new Set([
  "www",
  "meet",
  "coolify",
  "mail",
  "smtp",
  "imap",
  "api",
  "admin",
  "app",
  "static",
  "cdn",
  "assets",
  "ns1",
  "ns2",
  "default",
  "root",
  "join",
  "invite",
  "login",
  "register",
  "c",
]);

export type SlugCheck = { ok: true; slug: string } | { ok: false; reason: "format" | "reserved" };

/**
 * Validates a community slug. Kept strict because the slug is used as a DNS label:
 * lowercase letters, digits and inner hyphens, 3–40 characters.
 */
export function checkCommunitySlug(raw: string): SlugCheck {
  const slug = raw.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug)) return { ok: false, reason: "format" };
  if (RESERVED_COMMUNITY_SLUGS.has(slug)) return { ok: false, reason: "reserved" };
  return { ok: true, slug };
}

/** Turns a community name into a slug candidate. */
export function slugifyCommunityName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[äÄ]/g, "ae")
    .replace(/[öÖ]/g, "oe")
    .replace(/[üÜ]/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/**
 * Picks the community a request acts in, given the account's active memberships and whatever the
 * cookie asked for.
 *
 * Pure on purpose: this is the decision every request depends on, and the interesting cases – a
 * cookie naming a community the account left, a deleted community, no membership at all – are
 * exactly the ones that are awkward to reach through a browser. The caller supplies memberships
 * that are already filtered to *active* ones of *live* communities (see domain/communities.ts).
 */
export function pickActiveCommunity<T extends { communityId: string }>(memberships: T[], wanted: string | undefined | null): T | null {
  if (memberships.length === 0) return null;
  const asked = wanted ? memberships.find((m) => m.communityId === wanted) : undefined;
  // An unknown or stale cookie silently falls back rather than locking the person out; the list is
  // ordered root-first, so the fallback is the most predictable community they belong to.
  return asked ?? memberships[0];
}

// ---------------------------------------------------------------------------
// Sub-domains (docs/communities.md §7, stage A)
// ---------------------------------------------------------------------------

/**
 * Deliberately **no** table of domains for this stage: a community's sub-domain is its slug, and the
 * slug is already unique, validated as a DNS label and never changed. A second place to store the
 * same fact would only be something to keep in sync. The table arrives with stage B, where hosts are
 * arbitrary and have to be verified.
 */

/** The bare host an URL is served under: no protocol, no port, lowercase. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Strips the port and lowercases what a `Host:` header gave us. */
export function normalizeHost(host: string | null | undefined): string {
  return (host ?? "").split(":")[0]!.trim().toLowerCase().replace(/\.$/, "");
}

/**
 * The community slug a request host points at, or null for the main host and anything foreign.
 *
 * Only one label deep: `lesekreis.ai-up.club` yes, `a.b.ai-up.club` no – the wildcard certificate
 * covers exactly one level, so a deeper name could not be served anyway.
 */
export function subdomainSlug(requestHost: string | null | undefined, appHost: string): string | null {
  const host = normalizeHost(requestHost);
  const base = normalizeHost(appHost);
  if (!host || !base || host === base) return null;
  if (!host.endsWith(`.${base}`)) return null;
  const label = host.slice(0, -(base.length + 1));
  if (!label || label.includes(".")) return null;
  const checked = checkCommunitySlug(label);
  return checked.ok ? checked.slug : null;
}

/** The host a community is reachable under when sub-domains are switched on. */
export function communityHost(slug: string, appHost: string): string {
  return slug === ROOT_COMMUNITY_SLUG ? appHost : `${slug}.${appHost}`;
}

// ---------------------------------------------------------------------------
// Custom domains (docs/communities.md §7, stage B)
// ---------------------------------------------------------------------------

export type HostCheck = { ok: true; host: string } | { ok: false; reason: "format" | "ownDomain" };

/**
 * Validates a host a community wants to be served under.
 *
 * Strict, because the value ends up in a certificate request and in an origin the app trusts.
 * What is *not* checked here is ownership – that is what the DNS proof is for; this only decides
 * whether the string could be a host at all and whether it is ours to give away.
 *
 * Anything under the app host is refused: those names belong to the sub-domain scheme, where the
 * label is the community's slug and no row is needed. Letting someone claim `other.ai-up.club`
 * here would create a second, unverified way to own a name the slug rules already govern – and the
 * operator's own names (`meet`, `coolify`, `www`) sit there too.
 */
export function checkCustomHost(raw: string, appHost: string): HostCheck {
  // Tolerate a pasted URL or a trailing dot – people copy addresses, they do not type hostnames.
  let host = (raw ?? "").trim().toLowerCase();
  if (host.includes("://")) host = hostOf(host);
  host = normalizeHost(host);
  if (!host || host.length > 253) return { ok: false, reason: "format" };

  const labels = host.split(".");
  // At least two labels, and never a bare IP: a single-label name is not reachable from the public
  // internet, and an address cannot be proven by a DNS record or carry a certificate.
  if (labels.length < 2) return { ok: false, reason: "format" };
  if (/^[0-9.]+$/.test(host)) return { ok: false, reason: "format" };
  if (!labels.every((l) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l))) return { ok: false, reason: "format" };

  const base = normalizeHost(appHost);
  if (base && (host === base || host.endsWith(`.${base}`))) return { ok: false, reason: "ownDomain" };

  return { ok: true, host };
}

/** The DNS name whose TXT record proves control over `host`. */
export function verifyRecordName(host: string): string {
  return `_aiup-verify.${host}`;
}

export type DnsProof = { txt: string[]; cname: string[] };

/**
 * Does what DNS returned prove control? Pure, because this is the decision the whole feature rests
 * on and the records that make it interesting – a token among several TXT values, a CNAME to a
 * sub-domain of the app host, a near-miss – are awkward to arrange in real DNS.
 *
 * The CNAME counts because only the zone's owner can create it, and it is the record the domain
 * needs anyway to reach us. A CNAME *below* the app host counts too: with sub-domains switched on
 * that is exactly where an operator would point people.
 */
export function proofMatches(found: DnsProof, token: string, appHost: string): boolean {
  const host = appHost.toLowerCase();
  if (token && found.txt.includes(token)) return true;
  return found.cname.some((c) => c === host || c.endsWith(`.${host}`));
}
