import { asc, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLog, llmModelCapabilities, llmProviders, type LlmModelCapabilityRow, type LlmModelInfo, type LlmProvider } from "@/server/db/schema";
import { decryptSecret, encryptSecret, maskSecret } from "@/server/crypto";
import { env } from "@/server/env";
import { loadAppSettings } from "@/server/domain/settings";
import { chatCompletion, listModels, type ChatRequest, type LlmClientConfig, type ProviderKind } from "./client";
import { capabilityFingerprint, mergeCapabilities, mergeCapabilityInput, type CapabilityInput, type ResolvedCapabilities } from "./capabilities";

export const PROVIDER_PRESETS: Record<ProviderKind, { label: string; baseUrl: string; hint: string }> = {
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", hint: "Router with hundreds of models; model list includes capabilities and pricing." },
  cortecs: { label: "Cortecs.ai", baseUrl: "https://api.cortecs.ai/v1", hint: "EU-hosted router, OpenAI-compatible." },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", hint: "Direct OpenAI API." },
  generic: { label: "Generic (OpenAI-compatible)", baseUrl: "", hint: "Any endpoint exposing /chat/completions (vLLM, Ollama, Azure gateway, …). If /models is missing, add model ids manually." },
};

export type ProviderView = Omit<LlmProvider, "apiKeyEncrypted"> & { apiKeyMasked: string | null; hasApiKey: boolean };

export function toView(p: LlmProvider): ProviderView {
  const { apiKeyEncrypted, ...rest } = p;
  let masked: string | null = null;
  if (apiKeyEncrypted) {
    try {
      masked = maskSecret(decryptSecret(apiKeyEncrypted));
    } catch {
      masked = "••••";
    }
  }
  return { ...rest, apiKeyMasked: masked, hasApiKey: !!apiKeyEncrypted };
}

export async function listProviders(): Promise<ProviderView[]> {
  const rows = await db.query.llmProviders.findMany({ orderBy: [asc(llmProviders.createdAt)] });
  return rows.map(toView);
}

export async function getProvider(id: string): Promise<LlmProvider | undefined> {
  return db.query.llmProviders.findFirst({ where: eq(llmProviders.id, id) });
}

export async function getDefaultProvider(): Promise<LlmProvider | undefined> {
  return (await db.query.llmProviders.findFirst({ where: eq(llmProviders.isDefault, true) })) ?? (await db.query.llmProviders.findFirst({ orderBy: [asc(llmProviders.createdAt)] }));
}

export type ProviderInput = {
  name: string;
  kind: ProviderKind;
  baseUrl: string;
  /** undefined = keep existing; "" = clear */
  apiKey?: string;
  extraHeaders?: Record<string, string>;
};

export async function createProvider(input: ProviderInput, actorId: string): Promise<LlmProvider> {
  const count = (await db.query.llmProviders.findMany({ columns: { id: true } })).length;
  const [row] = await db
    .insert(llmProviders)
    .values({
      name: input.name.trim(),
      kind: input.kind,
      baseUrl: input.baseUrl.trim().replace(/\/+$/, ""),
      apiKeyEncrypted: input.apiKey ? encryptSecret(input.apiKey.trim()) : null,
      extraHeaders: input.extraHeaders ?? {},
      isDefault: count === 0,
    })
    .returning();
  await db.insert(auditLog).values({ actorId, action: "llm_provider.created", targetType: "llm_provider", targetId: row.id, details: { name: row.name, kind: row.kind } });
  return row;
}

export async function updateProvider(id: string, input: ProviderInput, actorId: string): Promise<LlmProvider | undefined> {
  const patch: Partial<typeof llmProviders.$inferInsert> = {
    name: input.name.trim(),
    kind: input.kind,
    baseUrl: input.baseUrl.trim().replace(/\/+$/, ""),
    extraHeaders: input.extraHeaders ?? {},
  };
  if (input.apiKey !== undefined) patch.apiKeyEncrypted = input.apiKey ? encryptSecret(input.apiKey.trim()) : null;
  const [row] = await db.update(llmProviders).set(patch).where(eq(llmProviders.id, id)).returning();
  if (row) await db.insert(auditLog).values({ actorId, action: "llm_provider.updated", targetType: "llm_provider", targetId: id, details: { name: row.name } });
  return row;
}

export async function deleteProvider(id: string, actorId: string): Promise<void> {
  await db.delete(llmProviders).where(eq(llmProviders.id, id));
  await db.insert(auditLog).values({ actorId, action: "llm_provider.deleted", targetType: "llm_provider", targetId: id });
}

export async function setDefaultProvider(id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(llmProviders).set({ isDefault: false });
    await tx.update(llmProviders).set({ isDefault: true }).where(eq(llmProviders.id, id));
  });
}

export async function setEnabledModels(id: string, enabledModels: string[], defaultModel: string | null): Promise<void> {
  await db.update(llmProviders).set({ enabledModels, defaultModel: defaultModel && enabledModels.includes(defaultModel) ? defaultModel : enabledModels[0] ?? null }).where(eq(llmProviders.id, id));
}

/** Adds manually entered model ids (generic endpoints without /models). */
export async function addManualModels(id: string, ids: string[]): Promise<void> {
  const p = await getProvider(id);
  if (!p) return;
  const existing = new Map(p.availableModels.map((m) => [m.id, m]));
  for (const mid of ids.map((s) => s.trim()).filter(Boolean)) if (!existing.has(mid)) existing.set(mid, { id: mid });
  const availableModels = [...existing.values()];
  const enabledModels = [...new Set([...p.enabledModels, ...ids])];
  await db.update(llmProviders).set({ availableModels, enabledModels, defaultModel: p.defaultModel ?? enabledModels[0] ?? null }).where(eq(llmProviders.id, id));
}

export async function clientConfigFor(p: LlmProvider): Promise<LlmClientConfig> {
  const settings = await loadAppSettings();
  return {
    kind: p.kind,
    baseUrl: p.baseUrl,
    apiKey: p.apiKeyEncrypted ? decryptSecret(p.apiKeyEncrypted) : null,
    extraHeaders: p.extraHeaders,
    appName: settings.name,
    appUrl: env.APP_URL,
  };
}

/** Fetches /models and stores the list (keeps enabled selection where still available). */
export async function syncProviderModels(id: string): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const p = await getProvider(id);
  if (!p) return { ok: false, error: "provider not found" };
  try {
    const models = await listModels(await clientConfigFor(p));
    const ids = new Set(models.map((m) => m.id));
    // keep manual entries that the endpoint does not list
    const manual = p.availableModels.filter((m) => !m.supportedParameters && !ids.has(m.id) && p.enabledModels.includes(m.id));
    const availableModels: LlmModelInfo[] = [...models, ...manual];
    const enabledModels = p.enabledModels.filter((m) => availableModels.some((a) => a.id === m));
    await db
      .update(llmProviders)
      .set({ availableModels, enabledModels, defaultModel: p.defaultModel && enabledModels.includes(p.defaultModel) ? p.defaultModel : enabledModels[0] ?? null, lastSyncedAt: new Date(), lastError: null })
      .where(eq(llmProviders.id, id));
    return { ok: true, count: models.length };
  } catch (err) {
    const message = (err as Error).message;
    await db.update(llmProviders).set({ lastError: message }).where(eq(llmProviders.id, id));
    return { ok: false, error: message };
  }
}

/** Resolves provider + model for a workflow step ("default" provider / model allowed). */
// ---------------------------------------------------------------------------
// Model capabilities (admin-maintained, see docs/modell-faehigkeiten.md)
// ---------------------------------------------------------------------------

export async function getCapabilityRow(modelId: string): Promise<LlmModelCapabilityRow | undefined> {
  return db.query.llmModelCapabilities.findFirst({ where: eq(llmModelCapabilities.modelId, modelId) });
}

/** All rows at once – for lists that would otherwise query per model. */
export async function getCapabilityMap(): Promise<Map<string, LlmModelCapabilityRow>> {
  const rows = await db.query.llmModelCapabilities.findMany();
  return new Map(rows.map((r) => [r.modelId, r]));
}

export async function listCapabilityRows(): Promise<LlmModelCapabilityRow[]> {
  return db.query.llmModelCapabilities.findMany({ orderBy: [asc(llmModelCapabilities.modelId)] });
}

export type { CapabilityInput };

export type CapabilityUpsertResult = { modelId: string; result: "created" | "updated" | "unchanged" };

/**
 * Upserts capability rows by model id. Merge semantics: an omitted field keeps whatever is stored,
 * so a partial correction cannot silently wipe the rest. `checkedAt` is refreshed either way –
 * re-confirming an unchanged row is worth recording.
 */
export async function upsertCapabilities(models: CapabilityInput[], source: string, actorId: string): Promise<CapabilityUpsertResult[]> {
  const results: CapabilityUpsertResult[] = [];
  for (const input of models) {
    const existing = await getCapabilityRow(input.modelId);
    const fields = mergeCapabilityInput(existing, input);
    if (!existing) {
      await db.insert(llmModelCapabilities).values({ ...fields, modelId: input.modelId, source, checkedAt: new Date(), updatedBy: actorId });
      results.push({ modelId: input.modelId, result: "created" });
      continue;
    }
    const changed = capabilityFingerprint(existing, existing.source) !== capabilityFingerprint(fields, source);
    await db
      .update(llmModelCapabilities)
      .set({ ...fields, source, checkedAt: new Date(), updatedBy: actorId })
      .where(eq(llmModelCapabilities.modelId, input.modelId));
    results.push({ modelId: input.modelId, result: changed ? "updated" : "unchanged" });
  }
  return results;
}

export async function deleteCapabilityRow(modelId: string): Promise<boolean> {
  const rows = await db.delete(llmModelCapabilities).where(eq(llmModelCapabilities.modelId, modelId)).returning({ id: llmModelCapabilities.id });
  return rows.length > 0;
}

export async function resolveModelCapabilities(modelId: string, info: LlmModelInfo | undefined, kind: ProviderKind | undefined): Promise<ResolvedCapabilities> {
  return mergeCapabilities(await getCapabilityRow(modelId), info, kind);
}

export async function resolveModel(
  providerId: string | undefined | null,
  model: string | undefined | null,
): Promise<{ provider: LlmProvider; model: string; info: LlmModelInfo | undefined; caps: ResolvedCapabilities }> {
  const provider = providerId && providerId !== "default" ? await getProvider(providerId) : await getDefaultProvider();
  if (!provider) throw new Error("No LLM provider configured. Add one under Admin → LLM.");
  const chosen = model && model !== "default" ? model : provider.defaultModel ?? provider.enabledModels[0];
  if (!chosen) throw new Error(`Provider "${provider.name}" has no enabled models.`);
  if (provider.enabledModels.length && !provider.enabledModels.includes(chosen)) throw new Error(`Model "${chosen}" is not enabled for provider "${provider.name}".`);
  const info = provider.availableModels.find((m) => m.id === chosen);
  return { provider, model: chosen, info, caps: await resolveModelCapabilities(chosen, info, provider.kind) };
}

export async function runChat(providerId: string | undefined | null, req: ChatRequest) {
  const { provider, model } = await resolveModel(providerId, req.model);
  return chatCompletion(await clientConfigFor(provider), { ...req, model });
}

/**
 * Provider + enabled-model list for the pickers (workflow editor, template evaluation, agents).
 * `supportsTools` is tri-state: undefined while nobody has stated it and the provider reports
 * nothing – the agent picker warns about those instead of hiding them.
 */
export async function listProviderOptions(): Promise<
  { id: string; name: string; kind: ProviderKind; isDefault: boolean; defaultModel: string | null; models: { id: string; name?: string; supportsTools?: boolean }[] }[]
> {
  const [providers, caps] = await Promise.all([listProviders(), getCapabilityMap()]);
  return providers.map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    isDefault: p.isDefault,
    defaultModel: p.defaultModel,
    models: p.availableModels
      .filter((m) => p.enabledModels.includes(m.id))
      .map((m) => {
        const row = caps.get(m.id);
        const stated = row?.tools ?? (m.supportedParameters ? m.supportedParameters.includes("tools") : undefined);
        return { id: m.id, name: m.name, supportsTools: stated };
      }),
  }));
}
