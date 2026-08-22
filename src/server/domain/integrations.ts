import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLog, integrations, type Integration } from "@/server/db/schema";
import { decryptSecret, encryptSecret, maskSecret } from "@/server/crypto";

/**
 * Integration settings (LiveKit now, others later). Public config in JSON, secrets encrypted as one JSON blob.
 */
export type LiveKitConfig = {
  /** wss://meet.example.com (client) – also used for server API calls (converted to https) */
  url: string;
  apiKey: string;
  /** host path where egress writes files; the worker reads the same path (mount) */
  recordingsPath: string;
  /** room composite egress default for audio/video meetings */
  recordingDefault: boolean;
};
export type LiveKitSecrets = { apiSecret: string };

export async function getIntegration(id: string): Promise<Integration | undefined> {
  return db.query.integrations.findFirst({ where: eq(integrations.id, id) });
}

export async function saveIntegration(id: string, input: { enabled: boolean; config: Record<string, unknown>; secrets?: Record<string, string> }, actorId: string): Promise<Integration> {
  const existing = await getIntegration(id);
  let secretsEncrypted = existing?.secretsEncrypted ?? null;
  if (input.secrets) {
    const current = existing?.secretsEncrypted ? (JSON.parse(decryptSecret(existing.secretsEncrypted)) as Record<string, string>) : {};
    const merged = { ...current };
    for (const [k, v] of Object.entries(input.secrets)) if (v !== undefined && v !== "__keep__") merged[k] = v;
    secretsEncrypted = encryptSecret(JSON.stringify(merged));
  }
  const [row] = await db
    .insert(integrations)
    .values({ id, enabled: input.enabled, config: input.config, secretsEncrypted })
    .onConflictDoUpdate({ target: integrations.id, set: { enabled: input.enabled, config: input.config, secretsEncrypted, updatedAt: new Date() } })
    .returning();
  await db.insert(auditLog).values({ actorId, action: "integration.updated", targetType: "integration", targetId: id, details: { enabled: input.enabled } });
  return row;
}

export async function recordIntegrationTest(id: string, result: string): Promise<void> {
  await db.update(integrations).set({ lastTestAt: new Date(), lastTestResult: result.slice(0, 500) }).where(eq(integrations.id, id));
}

function secretsOf(row: Integration | undefined): Record<string, string> {
  if (!row?.secretsEncrypted) return {};
  try {
    return JSON.parse(decryptSecret(row.secretsEncrypted)) as Record<string, string>;
  } catch {
    return {};
  }
}

/** Full LiveKit config incl. secret – server-side only. Returns null when not configured/enabled. */
export async function getLiveKitConfig(): Promise<(LiveKitConfig & LiveKitSecrets & { enabled: boolean }) | null> {
  const row = await getIntegration("livekit");
  if (!row) return null;
  const c = row.config as Partial<LiveKitConfig>;
  const s = secretsOf(row);
  if (!c.url || !c.apiKey || !s.apiSecret) return null;
  return { url: c.url, apiKey: c.apiKey, apiSecret: s.apiSecret, recordingsPath: c.recordingsPath ?? "/data/recordings", recordingDefault: c.recordingDefault ?? true, enabled: row.enabled };
}

/** Admin view: config + masked secret state. */
export async function getLiveKitView() {
  const row = await getIntegration("livekit");
  const c = (row?.config ?? {}) as Partial<LiveKitConfig>;
  const s = secretsOf(row);
  return {
    enabled: row?.enabled ?? false,
    url: c.url ?? "",
    apiKey: c.apiKey ?? "",
    recordingsPath: c.recordingsPath ?? "/data/recordings",
    recordingDefault: c.recordingDefault ?? true,
    hasSecret: !!s.apiSecret,
    secretMasked: s.apiSecret ? maskSecret(s.apiSecret) : null,
    lastTestAt: row?.lastTestAt ?? null,
    lastTestResult: row?.lastTestResult ?? null,
  };
}

/** https URL for server API calls derived from the ws(s) URL. */
export function livekitHttpUrl(url: string): string {
  return url.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/$/, "");
}
