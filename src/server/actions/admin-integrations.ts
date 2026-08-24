"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { RoomServiceClient } from "livekit-server-sdk";
import { assertAdmin } from "@/server/auth/session";
import { getLiveKitConfig, livekitHttpUrl, recordIntegrationTest, saveIntegration } from "@/server/domain/integrations";

const schema = z.object({
  enabled: z.boolean(),
  url: z.string().trim().url().refine((u) => /^(wss?|https?):\/\//.test(u), "url must start with wss:// or https://"),
  apiKey: z.string().trim().min(3).max(120),
  apiSecret: z.string().optional(),
  recordingsPath: z.string().trim().min(1).max(300),
  recordingDefault: z.boolean(),
  s3Endpoint: z.string().trim().max(300).refine((v) => v === "" || /^https?:\/\//.test(v), "s3Endpoint must be empty or start with https://"),
  s3Region: z.string().trim().max(60),
  s3Bucket: z.string().trim().max(120),
  s3AccessKey: z.string().trim().max(200),
  s3SecretKey: z.string().optional(),
});

/** A submitted secret is only stored when it is neither empty nor the "keep current value" marker. */
function keepable(value: string | undefined): value is string {
  return value !== undefined && value !== "__keep__" && value !== "";
}

export type LiveKitFormState = { status: "idle" } | { status: "saved" } | { status: "error"; message: string };

export async function saveLiveKitAction(_prev: LiveKitFormState, formData: FormData): Promise<LiveKitFormState> {
  const admin = await assertAdmin();
  const parsed = schema.safeParse({
    enabled: formData.get("enabled") === "on",
    url: formData.get("url"),
    apiKey: formData.get("apiKey"),
    apiSecret: formData.get("apiSecret") ?? undefined,
    recordingsPath: formData.get("recordingsPath"),
    recordingDefault: formData.get("recordingDefault") === "on",
    s3Endpoint: formData.get("s3Endpoint") ?? "",
    s3Region: formData.get("s3Region") ?? "",
    s3Bucket: formData.get("s3Bucket") ?? "",
    s3AccessKey: formData.get("s3AccessKey") ?? "",
    s3SecretKey: formData.get("s3SecretKey") ?? undefined,
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ") };
  const d = parsed.data;
  const url = d.url.replace(/^https:/, "wss:").replace(/^http:/, "ws:").replace(/\/$/, "");
  const secrets: Record<string, string> = {};
  if (keepable(d.apiSecret)) secrets.apiSecret = d.apiSecret;
  if (keepable(d.s3SecretKey)) secrets.s3SecretKey = d.s3SecretKey;
  await saveIntegration(
    "livekit",
    {
      enabled: d.enabled,
      config: {
        url,
        apiKey: d.apiKey,
        recordingsPath: d.recordingsPath,
        recordingDefault: d.recordingDefault,
        s3Endpoint: d.s3Endpoint.replace(/\/$/, ""),
        s3Region: d.s3Region,
        s3Bucket: d.s3Bucket,
        s3AccessKey: d.s3AccessKey,
      },
      secrets: Object.keys(secrets).length > 0 ? secrets : undefined,
    },
    admin.id,
  );
  revalidatePath("/admin/integrations");
  return { status: "saved" };
}

export async function testLiveKitAction(): Promise<{ ok: true; rooms: number; ms: number } | { ok: false; error: string }> {
  await assertAdmin();
  const cfg = await getLiveKitConfig();
  if (!cfg) return { ok: false, error: "not configured" };
  const started = Date.now();
  try {
    const client = new RoomServiceClient(livekitHttpUrl(cfg.url), cfg.apiKey, cfg.apiSecret);
    const rooms = await client.listRooms();
    const res = { ok: true as const, rooms: rooms.length, ms: Date.now() - started };
    await recordIntegrationTest("livekit", `ok: ${rooms.length} rooms, ${res.ms} ms`);
    revalidatePath("/admin/integrations");
    return res;
  } catch (err) {
    const message = (err as Error).message;
    await recordIntegrationTest("livekit", `error: ${message}`);
    revalidatePath("/admin/integrations");
    return { ok: false, error: message };
  }
}
