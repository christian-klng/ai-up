import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import { apiKeys, auditLog, communities, communityMembers, users, type ApiKey, type Community, type CommunityMember, type User } from "@/server/db/schema";

/**
 * API keys for MCP / external tooling. Format: aiup_<prefix8>_<secret32>; only the sha256 hash is stored.
 * A key belongs to one admin *and one community*: it acts only there, so a root admin who also
 * runs a sub-community creates one key per community (see docs/communities.md §1.11).
 */
/** `meetings:invite` is deliberately separate from `meetings:write`: switching an invite link on lets strangers create active accounts. */
export const API_SCOPES = ["workflows:read", "workflows:write", "runs:read", "runs:trigger", "llm:read", "llm:write", "questions:read", "landing:read", "landing:write", "knowledge:read", "knowledge:write", "meetings:read", "meetings:write", "meetings:invite"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

function hash(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export async function createApiKey(communityId: string, userId: string, name: string, scopes: ApiScope[], expiresAt: Date | null): Promise<{ key: ApiKey; plaintext: string }> {
  const prefix = randomBytes(6).toString("base64url").slice(0, 8);
  const secret = randomBytes(32).toString("base64url");
  const plaintext = `aiup_${prefix}_${secret}`;
  const [key] = await db.insert(apiKeys).values({ communityId, userId, name: name.trim().slice(0, 80), prefix, keyHash: hash(plaintext), scopes, expiresAt }).returning();
  await db.insert(auditLog).values({ communityId, actorId: userId, action: "api_key.created", targetType: "api_key", targetId: key.id, details: { name: key.name, scopes } });
  return { key, plaintext };
}

export async function listApiKeys(communityId: string, userId?: string): Promise<(ApiKey & { ownerName: string })[]> {
  const rows = await db
    .select({ key: apiKeys, ownerName: users.name })
    .from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.userId))
    .where(and(eq(apiKeys.communityId, communityId), userId ? eq(apiKeys.userId, userId) : undefined))
    .orderBy(desc(apiKeys.createdAt));
  return rows.map((r) => ({ ...r.key, ownerName: r.ownerName }));
}

export async function revokeApiKey(communityId: string, id: string, actorId: string): Promise<void> {
  await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.communityId, communityId), isNull(apiKeys.revokedAt)));
  await db.insert(auditLog).values({ communityId, actorId, action: "api_key.revoked", targetType: "api_key", targetId: id });
}

/** What an authenticated MCP request may do: the owner, the community it acts in, and the scopes. */
export type ApiAuth = { key: ApiKey; user: User; community: Community; membership: CommunityMember; scopes: Set<string> };

/**
 * Verifies a bearer token. Returns null when unknown/revoked/expired, when the community is gone,
 * or when the owner is no longer an active admin *of that community* – the key never outlives the
 * permission it was created under.
 */
export async function authenticateApiKey(token: string | null | undefined): Promise<ApiAuth | null> {
  if (!token || !token.startsWith("aiup_")) return null;
  const key = await db.query.apiKeys.findFirst({ where: eq(apiKeys.keyHash, hash(token)) });
  if (!key || key.revokedAt || (key.expiresAt && key.expiresAt < new Date())) return null;
  const user = await db.query.users.findFirst({ where: eq(users.id, key.userId) });
  if (!user || user.status !== "active") return null;
  const community = await db.query.communities.findFirst({ where: eq(communities.id, key.communityId) });
  if (!community || community.deletedAt) return null;
  const membership = await db.query.communityMembers.findFirst({
    where: and(eq(communityMembers.communityId, key.communityId), eq(communityMembers.userId, user.id)),
  });
  if (!membership || membership.status !== "active" || membership.role !== "admin") return null;
  void db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id)).catch(() => {});
  return { key, user, community, membership, scopes: new Set(key.scopes) };
}

export function hasScope(auth: ApiAuth, scope: ApiScope): boolean {
  return auth.scopes.has(scope);
}
