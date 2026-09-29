"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { RoomServiceClient } from "livekit-server-sdk";
import { assertRootAdmin } from "@/server/auth/session";
import { getEventsView, getLiveKitConfig, livekitHttpUrl, recordIntegrationTest, saveIntegration } from "@/server/domain/integrations";
import { safeFetch } from "@/server/webreader/safe-fetch";
import { EVENT_WIDGET_SCRIPT_PATH, normalizeEventServiceUrl } from "@/lib/event-widgets";

const schema = z.object({
  enabled: z.boolean(),
  url: z.string().trim().url().refine((u) => /^(wss?|https?):\/\//.test(u), "url must start with wss:// or https://"),
  apiKey: z.string().trim().min(3).max(120),
  apiSecret: z.string().optional(),
  recordingsPath: z.string().trim().min(1).max(300),
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

export type LiveKitErrorCode = "urlInvalid" | "apiKeyRequired" | "recordingsPathRequired" | "s3EndpointInvalid" | "unexpected";
export type LiveKitFormState = { status: "idle" } | { status: "saved" } | { status: "error"; code: LiveKitErrorCode };

/** Maps the first failing field to a key the form resolves via `errors.<code>` in both locales. */
function errorCodeFor(field: PropertyKey | undefined): LiveKitErrorCode {
  switch (field) {
    case "url":
      return "urlInvalid";
    case "apiKey":
      return "apiKeyRequired";
    case "recordingsPath":
      return "recordingsPathRequired";
    case "s3Endpoint":
      return "s3EndpointInvalid";
    default:
      return "unexpected";
  }
}

export async function saveLiveKitAction(_prev: LiveKitFormState, formData: FormData): Promise<LiveKitFormState> {
  const admin = await assertRootAdmin();
  const parsed = schema.safeParse({
    enabled: formData.get("enabled") === "on",
    url: formData.get("url"),
    apiKey: formData.get("apiKey"),
    apiSecret: formData.get("apiSecret") ?? undefined,
    recordingsPath: formData.get("recordingsPath"),
    s3Endpoint: formData.get("s3Endpoint") ?? "",
    s3Region: formData.get("s3Region") ?? "",
    s3Bucket: formData.get("s3Bucket") ?? "",
    s3AccessKey: formData.get("s3AccessKey") ?? "",
    s3SecretKey: formData.get("s3SecretKey") ?? undefined,
  });
  if (!parsed.success) return { status: "error", code: errorCodeFor(parsed.error.issues[0]?.path[0]) };
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
  await assertRootAdmin();
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

export type EventsErrorCode = "urlInvalid" | "unexpected";
export type EventsFormState = { status: "idle" } | { status: "saved" } | { status: "error"; code: EventsErrorCode };

/** Event service whose widgets the public pages embed; stored as origin only. */
export async function saveEventsAction(_prev: EventsFormState, formData: FormData): Promise<EventsFormState> {
  const admin = await assertRootAdmin();
  const enabled = formData.get("enabled") === "on";
  const raw = String(formData.get("url") ?? "").trim();
  const url = normalizeEventServiceUrl(raw);
  // Without an address there is nothing to switch on; an empty field is fine while it stays off.
  if (!url && (enabled || raw !== "")) return { status: "error", code: "urlInvalid" };
  await saveIntegration("events", { enabled, config: { url: url ?? "" } }, admin.id);
  revalidatePath("/admin/integrations");
  // The public pages and the editor preview read the address on render.
  revalidatePath("/", "layout");
  return { status: "saved" };
}

/** Asks the event service for its list and its widget script – the two things a page needs from it. */
export async function testEventsAction(): Promise<{ ok: true; count: number; ms: number } | { ok: false; error: string }> {
  await assertRootAdmin();
  const url = normalizeEventServiceUrl((await getEventsView()).url);
  if (!url) return { ok: false, error: "not configured" };
  const started = Date.now();
  try {
    const [list, script] = await Promise.all([
      safeFetch(`${url}/v1/events?when=upcoming`, { timeoutMs: 8000, headers: { accept: "application/json" } }),
      safeFetch(`${url}${EVENT_WIDGET_SCRIPT_PATH}`, { timeoutMs: 8000, method: "HEAD" }),
    ]);
    if (list.status !== 200) throw new Error(`event list answered with status ${list.status}`);
    if (script.status !== 200) throw new Error(`widget script answered with status ${script.status}`);
    const events = (JSON.parse(list.body.toString("utf8")) as { events?: unknown }).events;
    if (!Array.isArray(events)) throw new Error("the event list has an unexpected format");
    const res = { ok: true as const, count: events.length, ms: Date.now() - started };
    await recordIntegrationTest("events", `ok: ${res.count} upcoming events, ${res.ms} ms`);
    revalidatePath("/admin/integrations");
    return res;
  } catch (err) {
    const message = (err as Error).message;
    await recordIntegrationTest("events", `error: ${message}`);
    revalidatePath("/admin/integrations");
    return { ok: false, error: message };
  }
}
