import type { LlmModelInfo } from "@/server/db/schema";

/**
 * Minimal OpenAI-compatible chat client (fetch based). Works with OpenRouter, Cortecs.ai, OpenAI,
 * vLLM/Ollama-style endpoints. No SDK dependency so we can pass provider-specific extras
 * (e.g. OpenRouter `reasoning`) without fighting typings.
 */
export type ProviderKind = "openrouter" | "cortecs" | "openai" | "generic";

export type LlmClientConfig = {
  kind: ProviderKind;
  baseUrl: string; // e.g. https://openrouter.ai/api/v1
  apiKey?: string | null;
  extraHeaders?: Record<string, string>;
  appName?: string;
  appUrl?: string;
};

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stopSequences?: string[];
  seed?: number;
  reasoningEffort?: "none" | "low" | "medium" | "high";
  /** JSON schema for structured output (response_format json_schema) */
  jsonSchema?: Record<string, unknown>;
  /** Force JSON object mode without schema */
  jsonMode?: boolean;
  timeoutMs?: number;
};

export type ChatResponse = {
  text: string;
  model: string;
  finishReason: string | null;
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number; cost?: number };
  raw: unknown;
};

export class LlmError extends Error {
  constructor(
    message: string,
    public status?: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

function headers(cfg: LlmClientConfig): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json", ...(cfg.extraHeaders ?? {}) };
  if (cfg.apiKey) h.authorization = `Bearer ${cfg.apiKey}`;
  if (cfg.kind === "openrouter") {
    if (cfg.appUrl) h["HTTP-Referer"] = cfg.appUrl;
    if (cfg.appName) h["X-Title"] = cfg.appName;
  }
  return h;
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/** Builds the request body; provider-specific knobs live here. */
export function buildChatBody(kind: ProviderKind, req: ChatRequest): Record<string, unknown> {
  const body: Record<string, unknown> = { model: req.model, messages: req.messages };
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.topP !== undefined) body.top_p = req.topP;
  if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
  if (req.stopSequences?.length) body.stop = req.stopSequences;
  if (req.seed !== undefined) body.seed = req.seed;
  if (req.reasoningEffort && req.reasoningEffort !== "none") {
    if (kind === "openrouter") body.reasoning = { effort: req.reasoningEffort };
    else body.reasoning_effort = req.reasoningEffort;
  }
  if (req.jsonSchema) {
    body.response_format = { type: "json_schema", json_schema: { name: "workflow_output", strict: false, schema: req.jsonSchema } };
  } else if (req.jsonMode) {
    body.response_format = { type: "json_object" };
  }
  return body;
}

export async function chatCompletion(cfg: LlmClientConfig, req: ChatRequest): Promise<ChatResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? 120_000);
  try {
    const res = await fetch(joinUrl(cfg.baseUrl, "chat/completions"), {
      method: "POST",
      headers: headers(cfg),
      body: JSON.stringify(buildChatBody(cfg.kind, req)),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = JSON.parse(text);
    } catch {
      /* non-JSON error body */
    }
    if (!res.ok) {
      const msg = (data as { error?: { message?: string } } | null)?.error?.message ?? text.slice(0, 300);
      throw new LlmError(`LLM request failed (${res.status}): ${msg}`, res.status, data ?? text);
    }
    const d = data as {
      model?: string;
      choices?: { message?: { content?: string | { type: string; text?: string }[] }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number };
    };
    const choice = d.choices?.[0];
    const content = choice?.message?.content;
    const outText = typeof content === "string" ? content : Array.isArray(content) ? content.map((p) => p.text ?? "").join("") : "";
    return {
      text: outText,
      model: d.model ?? req.model,
      finishReason: choice?.finish_reason ?? null,
      usage: { promptTokens: d.usage?.prompt_tokens, completionTokens: d.usage?.completion_tokens, totalTokens: d.usage?.total_tokens, cost: d.usage?.cost },
      raw: data,
    };
  } catch (err) {
    if (err instanceof LlmError) throw err;
    if ((err as Error).name === "AbortError") throw new LlmError("LLM request timed out");
    throw new LlmError(`LLM request failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** GET /models – normalizes OpenRouter's rich metadata and plain OpenAI lists. */
export async function listModels(cfg: LlmClientConfig): Promise<LlmModelInfo[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(joinUrl(cfg.baseUrl, "models"), { headers: headers(cfg), signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) throw new LlmError(`Could not list models (${res.status}): ${text.slice(0, 200)}`, res.status);
    const data = JSON.parse(text) as { data?: unknown[]; models?: unknown[] };
    const list = (data.data ?? data.models ?? []) as Record<string, unknown>[];
    return list
      .map((m) => ({
        id: String(m.id ?? m.name ?? ""),
        name: typeof m.name === "string" ? m.name : undefined,
        contextLength: typeof m.context_length === "number" ? m.context_length : (m.top_provider as { context_length?: number } | undefined)?.context_length ?? null,
        supportedParameters: Array.isArray(m.supported_parameters) ? (m.supported_parameters as string[]) : undefined,
        pricing: m.pricing && typeof m.pricing === "object" ? { prompt: String((m.pricing as { prompt?: unknown }).prompt ?? ""), completion: String((m.pricing as { completion?: unknown }).completion ?? "") } : null,
      }))
      .filter((m) => m.id)
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch (err) {
    if (err instanceof LlmError) throw err;
    throw new LlmError(`Could not list models: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Which knobs a model supports (best effort; unknown → optimistic defaults). */
export function modelCapabilities(model?: LlmModelInfo | null, kind?: ProviderKind) {
  const sp = model?.supportedParameters;
  const has = (k: string) => (sp ? sp.includes(k) : true);
  return {
    temperature: has("temperature"),
    topP: has("top_p"),
    maxTokens: has("max_tokens"),
    reasoning: sp ? sp.includes("reasoning") || sp.includes("reasoning_effort") || sp.includes("include_reasoning") : kind === "openrouter" || kind === "openai",
    structuredOutputs: sp ? sp.includes("structured_outputs") || sp.includes("response_format") : true,
    seed: has("seed"),
    stop: has("stop"),
  };
}
