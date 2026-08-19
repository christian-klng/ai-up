import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "@/server/env";

/**
 * AES-256-GCM for secrets at rest (LLM API keys, Nextcloud app passwords).
 * Key = sha256(APP_ENCRYPTION_KEY). Format: v1:<iv b64>:<tag b64>:<ciphertext b64>
 */
function key(): Buffer {
  return createHash("sha256").update(env.APP_ENCRYPTION_KEY).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const [v, ivB64, tagB64, dataB64] = payload.split(":");
  if (v !== "v1" || !ivB64 || !tagB64 || !dataB64) throw new Error("invalid secret payload");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

/** Shows only the last 4 chars of a secret for UI display. */
export function maskSecret(plain: string): string {
  return plain.length <= 4 ? "••••" : `••••${plain.slice(-4)}`;
}
