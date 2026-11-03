import { createHash, randomBytes } from "node:crypto";
import { COMMUNITY_REQUEST_TTL_SECONDS, type CommunityDraft } from "@/lib/community-creation";
import { getRedis } from "@/server/redis";

/**
 * A community someone asked for from the public form, waiting for them to confirm their address.
 *
 * Redis rather than a table on purpose: until the address is confirmed nothing may exist – no
 * account, no reserved short name, no personal data that somebody would have to clean up later.
 * An unconfirmed request simply expires. Only a hash of the token is stored, so what Redis holds
 * cannot be turned back into a working link.
 */

export type CommunityRequest = {
  draft: CommunityDraft;
  founder: { name: string; email: string; locale: "de" | "en" };
  /** when the terms were accepted; goes into the audit log with the community */
  acceptedAt: string;
  /** end of the original period, so restoring a request after a failed attempt cannot extend it */
  expiresAt: number;
};

const key = (token: string) => `aiup:community-request:${createHash("sha256").update(token).digest("hex")}`;

export async function storeCommunityRequest(request: Omit<CommunityRequest, "expiresAt" | "acceptedAt">): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const full: CommunityRequest = { ...request, acceptedAt: new Date().toISOString(), expiresAt: Date.now() + COMMUNITY_REQUEST_TTL_SECONDS * 1000 };
  await getRedis().set(key(token), JSON.stringify(full), "EX", COMMUNITY_REQUEST_TTL_SECONDS);
  return token;
}

export async function peekCommunityRequest(token: string): Promise<CommunityRequest | null> {
  const raw = await getRedis().get(key(token));
  return raw ? (JSON.parse(raw) as CommunityRequest) : null;
}

/** Atomic, so a double click or a replayed link cannot create the community twice. */
export async function takeCommunityRequest(token: string): Promise<CommunityRequest | null> {
  const raw = await getRedis().getdel(key(token));
  return raw ? (JSON.parse(raw) as CommunityRequest) : null;
}

/** Puts a taken request back after a failure the founder can fix, keeping its original deadline. */
export async function restoreCommunityRequest(token: string, request: CommunityRequest): Promise<void> {
  const remaining = Math.ceil((request.expiresAt - Date.now()) / 1000);
  if (remaining > 0) await getRedis().set(key(token), JSON.stringify(request), "EX", remaining);
}

/**
 * Counts one attempt and says whether it stays within `max` per window. The key is hashed so that
 * neither addresses nor IPs sit readable in Redis for the length of the window.
 */
export async function withinRequestLimit(scope: "ip" | "email", value: string, max: number, windowSeconds: number): Promise<boolean> {
  const counter = `aiup:community-request-limit:${scope}:${createHash("sha256").update(value).digest("hex")}`;
  const redis = getRedis();
  const count = await redis.incr(counter);
  if (count === 1) await redis.expire(counter, windowSeconds);
  return count <= max;
}
