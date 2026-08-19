"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertAdmin } from "@/server/auth/session";
import { addManualModels, clientConfigFor, createProvider, deleteProvider, getProvider, setDefaultProvider, setEnabledModels, syncProviderModels, updateProvider } from "@/server/llm/providers";
import { chatCompletion } from "@/server/llm/client";

const providerSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(80),
  kind: z.enum(["openrouter", "cortecs", "openai", "generic"]),
  baseUrl: z.string().trim().url(),
  apiKey: z.string().optional(),
  extraHeaders: z.string().optional(),
});

export type ProviderFormState = { status: "idle" } | { status: "saved"; id: string } | { status: "error"; message: string };

export async function saveProviderAction(_prev: ProviderFormState, formData: FormData): Promise<ProviderFormState> {
  const admin = await assertAdmin();
  const parsed = providerSchema.safeParse({
    id: formData.get("id") || undefined,
    name: formData.get("name"),
    kind: formData.get("kind"),
    baseUrl: formData.get("baseUrl"),
    apiKey: formData.get("apiKey") ?? undefined,
    extraHeaders: formData.get("extraHeaders") ?? undefined,
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ") };
  const d = parsed.data;
  let extraHeaders: Record<string, string> = {};
  if (d.extraHeaders?.trim()) {
    try {
      const obj = JSON.parse(d.extraHeaders) as Record<string, unknown>;
      extraHeaders = Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, String(v)]));
    } catch {
      return { status: "error", message: "extraHeaders must be a JSON object" };
    }
  }
  // Empty apiKey on edit = keep; the form sends "__keep__" explicitly for that case
  const apiKey = d.apiKey === "__keep__" ? undefined : (d.apiKey ?? "");
  const row = d.id ? await updateProvider(d.id, { name: d.name, kind: d.kind, baseUrl: d.baseUrl, apiKey, extraHeaders }, admin.id) : await createProvider({ name: d.name, kind: d.kind, baseUrl: d.baseUrl, apiKey, extraHeaders }, admin.id);
  if (!row) return { status: "error", message: "not found" };
  revalidatePath("/admin/llm");
  return { status: "saved", id: row.id };
}

export async function deleteProviderAction(id: string): Promise<void> {
  const admin = await assertAdmin();
  await deleteProvider(id, admin.id);
  revalidatePath("/admin/llm");
}

export async function setDefaultProviderAction(id: string): Promise<void> {
  await assertAdmin();
  await setDefaultProvider(id);
  revalidatePath("/admin/llm");
}

export async function syncModelsAction(id: string): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  await assertAdmin();
  const res = await syncProviderModels(id);
  revalidatePath("/admin/llm");
  return res;
}

export async function setEnabledModelsAction(id: string, enabled: string[], defaultModel: string | null): Promise<void> {
  await assertAdmin();
  await setEnabledModels(id, enabled, defaultModel);
  revalidatePath("/admin/llm");
}

export async function addManualModelsAction(id: string, raw: string): Promise<void> {
  await assertAdmin();
  await addManualModels(id, raw.split(/[\n,]/));
  revalidatePath("/admin/llm");
}

export async function testProviderAction(id: string, model: string, prompt: string): Promise<{ ok: true; text: string; model: string; ms: number; usage: unknown } | { ok: false; error: string }> {
  await assertAdmin();
  const p = await getProvider(id);
  if (!p) return { ok: false, error: "provider not found" };
  const started = Date.now();
  try {
    const res = await chatCompletion(await clientConfigFor(p), { model, messages: [{ role: "user", content: prompt || "Say hello in one short sentence." }], maxTokens: 200, timeoutMs: 60_000 });
    return { ok: true, text: res.text, model: res.model, ms: Date.now() - started, usage: res.usage };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
