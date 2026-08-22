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
});

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
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ") };
  const d = parsed.data;
  const url = d.url.replace(/^https:/, "wss:").replace(/^http:/, "ws:").replace(/\/$/, "");
  await saveIntegration(
    "livekit",
    { enabled: d.enabled, config: { url, apiKey: d.apiKey, recordingsPath: d.recordingsPath, recordingDefault: d.recordingDefault }, secrets: d.apiSecret !== undefined && d.apiSecret !== "__keep__" && d.apiSecret !== "" ? { apiSecret: d.apiSecret } : undefined },
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
