import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import { apiKeys, auditLog, users, type ApiKey, type User } from "@/server/db/schema";

/**
 * API keys for MCP / external tooling. Format: aiup_<prefix8>_<secret32>; only the sha256 hash is stored.
 * Keys belong to an admin user; scopes restrict what the key may do.
 */
export const API_SCOPES = ["workflows:read", "workflows:write", "runs:read", "runs:trigger", "llm:read", "questions:read", "landing:read", "landing:write"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

function hash(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export async function createApiKey(userId: string, name: string, scopes: ApiScope[], expiresAt: Date | null): Promise<{ key: ApiKey; plaintext: string }> {
  const prefix = randomBytes(6).toString("base64url").slice(0, 8);
  const secret = randomBytes(32).toString("base64url");
  const plaintext = `aiup_${prefix}_${secret}`;
  const [key] = await db.insert(apiKeys).values({ userId, name: name.trim().slice(0, 80), prefix, keyHash: hash(plaintext), scopes, expiresAt }).returning();
  await db.insert(auditLog).values({ actorId: userId, action: "api_key.created", targetType: "api_key", targetId: key.id, details: { name: key.name, scopes } });
  return { key, plaintext };
}

export async function listApiKeys(userId?: string): Promise<(ApiKey & { ownerName: string })[]> {
  const rows = await db
    .select({ key: apiKeys, ownerName: users.name })
    .from(apiKeys)
    .innerJoin(users, eq(users.id, apiKeys.userId))
    .where(userId ? eq(apiKeys.userId, userId) : undefined)
    .orderBy(desc(apiKeys.createdAt));
  return rows.map((r) => ({ ...r.key, ownerName: r.ownerName }));
}

export async function revokeApiKey(id: string, actorId: string): Promise<void> {
  await db.update(apiKeys).set({ revokedAt: new Date() }).where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)));
  await db.insert(auditLog).values({ actorId, action: "api_key.revoked", targetType: "api_key", targetId: id });
}

export type ApiAuth = { key: ApiKey; user: User; scopes: Set<string> };

/** Verifies a bearer token; returns null when unknown/revoked/expired or the owner is no longer an active admin. */
export async function authenticateApiKey(token: string | null | undefined): Promise<ApiAuth | null> {
  if (!token || !token.startsWith("aiup_")) return null;
  const key = await db.query.apiKeys.findFirst({ where: eq(apiKeys.keyHash, hash(token)) });
  if (!key || key.revokedAt || (key.expiresAt && key.expiresAt < new Date())) return null;
  const user = await db.query.users.findFirst({ where: eq(users.id, key.userId) });
  if (!user || user.status !== "active" || user.role !== "admin") return null;
  void db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, key.id)).catch(() => {});
  return { key, user, scopes: new Set(key.scopes) };
}

export function hasScope(auth: ApiAuth, scope: ApiScope): boolean {
  return auth.scopes.has(scope);
}
