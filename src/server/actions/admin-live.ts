"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertAdmin } from "@/server/auth/session";
import { checkSttKey, DEFAULT_STT_MODEL, saveLiveSettings } from "@/server/domain/live-settings";
import type { AdminFormState } from "./admin-settings";

const schema = z.object({
  enabled: z.boolean(),
  sttModel: z.string().trim().max(100),
  apiKey: z.string().trim().max(500).optional(),
});

/** Live transcription in meetings – belongs to the community whose admin enters the key (docs/live-ki-agenten.md 7). */
export async function saveLiveSettingsAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const admin = await assertAdmin();
  const parsed = schema.safeParse({
    enabled: formData.get("enabled") === "on",
    sttModel: formData.get("sttModel") ?? "",
    apiKey: formData.get("apiKey") ?? undefined,
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message };
  const d = parsed.data;
  // "__keep__" (and an empty field) leave the stored key untouched
  const apiKey = d.apiKey && d.apiKey !== "__keep__" ? d.apiKey : undefined;
  await saveLiveSettings(admin.communityId, { enabled: d.enabled, sttModel: d.sttModel || DEFAULT_STT_MODEL, apiKey });
  if (apiKey) await checkSttKey(admin.communityId);
  revalidatePath("/admin/agents");
  return { status: "saved" };
}

export async function checkLiveKeyAction(): Promise<{ ok: true } | { ok: false; error: string }> {
  const admin = await assertAdmin();
  const res = await checkSttKey(admin.communityId);
  revalidatePath("/admin/agents");
  return res;
}
