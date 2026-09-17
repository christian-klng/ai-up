import { promises as dns } from "node:dns";
import { randomBytes } from "node:crypto";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { checkCustomHost, normalizeHost, proofMatches, verifyRecordName, type DnsProof } from "@/lib/community";
import { db } from "@/server/db/client";
import { communityDomains, type CommunityDomain } from "@/server/db/schema";
import { env } from "@/server/env";
import { logger } from "@/server/logger";

/**
 * A community's own domain (stage B, docs/communities.md §7).
 *
 * Two rules run through this module. First: **an unverified host does not exist.** Everything that
 * grants a host power – resolving a request to a community, trusting its origin, handing a session
 * to it, telling the proxy to get a certificate – asks for `verified_at`. Second: the host is never
 * taken from the request. It is looked up, and only a row that comes back decides anything; a
 * `Host:` header is an attacker-controlled string.
 */

/** Rows a community may own, so a stuck verification cannot be used to hoard names. */
const MAX_DOMAINS_PER_COMMUNITY = 5;
/** A failed lookup is usually "DNS has not propagated yet" – checking again in a second is pointless. */
const RECHECK_AFTER_MS = 20_000;

// ---------------------------------------------------------------------------
// The hot path: host → community
// ---------------------------------------------------------------------------

/**
 * Verified hosts, cached in the process.
 *
 * The lookup happens in every request and in Better Auth's origin check, while the table holds a
 * handful of rows that change by hand. A short time-to-live is the right trade: a new domain starts
 * working within a minute, and the writes below clear the cache in their own process straight away.
 */
let hostCache: { at: number; byHost: Map<string, string> } | null = null;
const HOST_CACHE_MS = 60_000;

export function clearDomainCache(): void {
  hostCache = null;
}

async function verifiedHosts(): Promise<Map<string, string>> {
  if (hostCache && Date.now() - hostCache.at < HOST_CACHE_MS) return hostCache.byHost;
  const rows = await db
    .select({ host: communityDomains.host, communityId: communityDomains.communityId })
    .from(communityDomains)
    .where(isNotNull(communityDomains.verifiedAt));
  const byHost = new Map(rows.map((r) => [r.host, r.communityId]));
  hostCache = { at: Date.now(), byHost };
  return byHost;
}

/** The community a verified host belongs to, or null. Returns null while the feature is off. */
export async function communityIdForHost(host: string | null | undefined): Promise<string | null> {
  if (!env.COMMUNITY_CUSTOM_DOMAINS) return null;
  const wanted = normalizeHost(host);
  if (!wanted) return null;
  try {
    return (await verifiedHosts()).get(wanted) ?? null;
  } catch (err) {
    // Losing the database must not turn every request into a request for the main host.
    logger.error({ err, host: wanted }, "custom domains: host lookup failed");
    return null;
  }
}

/** Every verified host – for the origins Better Auth trusts and the proxy's certificate question. */
export async function listVerifiedHosts(): Promise<string[]> {
  if (!env.COMMUNITY_CUSTOM_DOMAINS) return [];
  try {
    return [...(await verifiedHosts()).keys()];
  } catch (err) {
    logger.error({ err }, "custom domains: could not list verified hosts");
    return [];
  }
}

/**
 * The host links to this community should use, or null when it has none. Only a verified primary
 * row counts – a link to an unverified host would not resolve.
 */
export async function primaryHostOf(communityId: string): Promise<string | null> {
  if (!env.COMMUNITY_CUSTOM_DOMAINS) return null;
  try {
    const row = await db.query.communityDomains.findFirst({
      where: and(eq(communityDomains.communityId, communityId), eq(communityDomains.isPrimary, true), isNotNull(communityDomains.verifiedAt)),
      columns: { host: true },
    });
    return row?.host ?? null;
  } catch (err) {
    logger.error({ err, communityId }, "custom domains: primary lookup failed");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Managing
// ---------------------------------------------------------------------------

export async function listCommunityDomains(communityId: string): Promise<CommunityDomain[]> {
  return db.query.communityDomains.findMany({
    where: eq(communityDomains.communityId, communityId),
    orderBy: (d, { desc, asc }) => [desc(d.isPrimary), asc(d.createdAt)],
  });
}

export type AddDomainResult =
  | { ok: true; domain: CommunityDomain }
  | { ok: false; reason: "invalid" | "ownDomain" | "taken" | "limit" };

/**
 * Registers a host for a community – unverified, so it does nothing until the DNS proof succeeds.
 *
 * `taken` covers a host another community already claimed *and* one this community claimed before:
 * the host is unique platform-wide, because a name can only ever point at one place.
 */
export async function addCommunityDomain(communityId: string, rawHost: string, userId: string): Promise<AddDomainResult> {
  const checked = checkCustomHost(rawHost, new URL(env.APP_URL).hostname);
  if (!checked.ok) return { ok: false, reason: checked.reason === "ownDomain" ? "ownDomain" : "invalid" };

  const existing = await listCommunityDomains(communityId);
  if (existing.length >= MAX_DOMAINS_PER_COMMUNITY) return { ok: false, reason: "limit" };

  const [row] = await db
    .insert(communityDomains)
    .values({ communityId, host: checked.host, verifyToken: randomBytes(16).toString("hex"), createdBy: userId })
    .onConflictDoNothing()
    .returning();
  if (!row) return { ok: false, reason: "taken" };
  logger.info({ communityId, host: row.host }, "custom domain added, awaiting verification");
  return { ok: true, domain: row };
}

/** Removes a domain. Scoped by community, so an id from elsewhere finds nothing. */
export async function removeCommunityDomain(communityId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(communityDomains)
    .where(and(eq(communityDomains.id, id), eq(communityDomains.communityId, communityId)))
    .returning({ host: communityDomains.host });
  clearDomainCache();
  if (rows.length) logger.info({ communityId, host: rows[0]!.host }, "custom domain removed");
  return rows.length > 0;
}

/**
 * Makes a verified domain the one links are built with. The other rows lose the flag first: the
 * partial unique index would otherwise reject the update, and a moment with two primaries would be
 * worse than a moment with none.
 */
export async function setPrimaryCommunityDomain(communityId: string, id: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const row = await tx.query.communityDomains.findFirst({
      where: and(eq(communityDomains.id, id), eq(communityDomains.communityId, communityId)),
    });
    if (!row || !row.verifiedAt) return false;
    await tx
      .update(communityDomains)
      .set({ isPrimary: false })
      .where(and(eq(communityDomains.communityId, communityId), ne(communityDomains.id, id)));
    await tx.update(communityDomains).set({ isPrimary: true }).where(eq(communityDomains.id, id));
    clearDomainCache();
    return true;
  });
}

// ---------------------------------------------------------------------------
// The DNS proof
// ---------------------------------------------------------------------------

export type VerifyResult =
  | { ok: true; domain: CommunityDomain }
  | { ok: false; reason: "notFound" | "tooSoon" | "noRecord" | "wrongValue" };

/**
 * Checks whether the owner of `host` has proven control, and switches the domain on if so.
 *
 * Two ways count. A TXT record at `_aiup-verify.<host>` carrying the token is the universal one –
 * it works for an apex domain, where a CNAME is not allowed. A CNAME from the host to the app host
 * counts as well, because only the zone's owner can create it and it is the record the domain needs
 * anyway to reach us; asking for a second one would be ceremony.
 *
 * Failure is never cached as success, and a lookup that throws (NXDOMAIN, no resolver) is a plain
 * "not yet" – the person is mid-setup, not doing something wrong.
 */
export async function verifyCommunityDomain(communityId: string, id: string): Promise<VerifyResult> {
  const row = await db.query.communityDomains.findFirst({
    where: and(eq(communityDomains.id, id), eq(communityDomains.communityId, communityId)),
  });
  if (!row) return { ok: false, reason: "notFound" };
  if (row.verifiedAt) return { ok: true, domain: row };
  if (row.lastCheckedAt && Date.now() - row.lastCheckedAt.getTime() < RECHECK_AFTER_MS) return { ok: false, reason: "tooSoon" };

  await db.update(communityDomains).set({ lastCheckedAt: new Date() }).where(eq(communityDomains.id, id));

  const appHost = new URL(env.APP_URL).hostname.toLowerCase();
  const found = await readProof(row.host);
  const proven = proofMatches(found, row.verifyToken, appHost);
  if (!proven) {
    logger.info({ communityId, host: row.host, txt: found.txt.length, cname: found.cname.length }, "custom domain: proof missing");
    return { ok: false, reason: found.txt.length || found.cname.length ? "wrongValue" : "noRecord" };
  }

  const [updated] = await db.update(communityDomains).set({ verifiedAt: new Date() }).where(eq(communityDomains.id, id)).returning();
  // The first verified domain becomes the primary one – otherwise entering a domain would visibly
  // do nothing until a second, unexplained click.
  if (updated && !(await primaryHostOf(communityId))) await setPrimaryCommunityDomain(communityId, id);
  clearDomainCache();
  logger.info({ communityId, host: row.host }, "custom domain verified");
  return { ok: true, domain: (await db.query.communityDomains.findFirst({ where: eq(communityDomains.id, id) }))! };
}

/** Both records in one go; a missing one is an empty list, not an error. */
async function readProof(host: string): Promise<DnsProof> {
  const [txt, cname] = await Promise.all([
    dns.resolveTxt(verifyRecordName(host)).catch(() => [] as string[][]),
    dns.resolveCname(host).catch(() => [] as string[]),
  ]);
  return {
    // A long TXT value arrives split into chunks – joining them is what every resolver does.
    txt: txt.map((parts) => parts.join("").trim()),
    cname: cname.map((c) => c.toLowerCase().replace(/\.$/, "")),
  };
}
