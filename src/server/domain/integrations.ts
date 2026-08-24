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
  /** host path egress writes to; only used when no S3 handover is configured (single host / dev) */
  recordingsPath: string;
  /** room composite egress default for audio/video meetings */
  recordingDefault: boolean;
  /** S3-compatible handover (e.g. Hetzner Object Storage); empty endpoint falls back to recordingsPath */
  s3Endpoint: string;
  s3Region: string;
  s3Bucket: string;
  s3AccessKey: string;
};
export type LiveKitSecrets = { apiSecret: string; s3SecretKey: string };

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
  return {
    url: c.url,
    apiKey: c.apiKey,
    apiSecret: s.apiSecret,
    recordingsPath: c.recordingsPath ?? "/data/recordings",
    recordingDefault: c.recordingDefault ?? true,
    s3Endpoint: c.s3Endpoint ?? "",
    s3Region: c.s3Region ?? "",
    s3Bucket: c.s3Bucket ?? "",
    s3AccessKey: c.s3AccessKey ?? "",
    s3SecretKey: s.s3SecretKey ?? "",
    enabled: row.enabled,
  };
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
    s3Endpoint: c.s3Endpoint ?? "",
    s3Region: c.s3Region ?? "",
    s3Bucket: c.s3Bucket ?? "",
    s3AccessKey: c.s3AccessKey ?? "",
    hasSecret: !!s.apiSecret,
    secretMasked: s.apiSecret ? maskSecret(s.apiSecret) : null,
    hasS3Secret: !!s.s3SecretKey,
    s3SecretMasked: s.s3SecretKey ? maskSecret(s.s3SecretKey) : null,
    lastTestAt: row?.lastTestAt ?? null,
    lastTestResult: row?.lastTestResult ?? null,
  };
}

/** https URL for server API calls derived from the ws(s) URL. */
export function livekitHttpUrl(url: string): string {
  return url.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/$/, "");
}

export type LiveKitS3 = { endpoint: string; region: string; bucket: string; accessKey: string; secretKey: string };

/**
 * S3 handover config, or null when incomplete – then recordings are read from `recordingsPath`
 * (single host and local development). The credentials travel with the egress request, so the
 * media server needs no S3 configuration of its own and never stores them.
 */
export function livekitS3(cfg: Pick<LiveKitConfig, "s3Endpoint" | "s3Region" | "s3Bucket" | "s3AccessKey"> & Pick<LiveKitSecrets, "s3SecretKey">): LiveKitS3 | null {
  if (!cfg.s3Endpoint || !cfg.s3Bucket || !cfg.s3AccessKey || !cfg.s3SecretKey) return null;
  return { endpoint: cfg.s3Endpoint, region: cfg.s3Region || "auto", bucket: cfg.s3Bucket, accessKey: cfg.s3AccessKey, secretKey: cfg.s3SecretKey };
}
