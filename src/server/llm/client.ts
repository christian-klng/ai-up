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

/** One function the model may call. `parameters` is a JSON Schema object. */
export type ToolDefinition = { name: string; description: string; parameters: Record<string, unknown> };

/** A tool call the model asked for. `arguments` stays a raw JSON string – parse at the call site. */
export type ToolCall = { id: string; name: string; arguments: string };

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; content: string; toolCallId: string };

export type ChatRequest = {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stopSequences?: string[];
  seed?: number;
  reasoningEffort?: "none" | "low" | "medium" | "high";
  /** Tools the model may call (agentic loop); omit for a plain completion. */
  tools?: ToolDefinition[];
  toolChoice?: "auto" | "none" | "required";
  /** JSON schema for structured output (response_format json_schema) */
  jsonSchema?: Record<string, unknown>;
  /** Force JSON object mode without schema */
  jsonMode?: boolean;
  timeoutMs?: number;
};

export type ChatUsage = { promptTokens?: number; completionTokens?: number; totalTokens?: number; cost?: number };

export type ChatResponse = {
  text: string;
  /** Reasoning tokens when the provider streams them separately (OpenRouter); usually empty. */
  reasoning: string;
  toolCalls: ToolCall[];
  model: string;
  finishReason: string | null;
  usage: ChatUsage;
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

/** Our message shape → OpenAI wire format (tool calls and tool results have their own fields). */
function toWireMessage(m: ChatMessage): Record<string, unknown> {
  if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
  if (m.role === "assistant" && m.toolCalls?.length) {
    return {
      role: "assistant",
      // A tool-calling turn often has no prose; the API wants null rather than "".
      content: m.content || null,
      tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })),
    };
  }
  return { role: m.role, content: m.content };
}

/** Builds the request body; provider-specific knobs live here. */
export function buildChatBody(kind: ProviderKind, req: ChatRequest): Record<string, unknown> {
  const body: Record<string, unknown> = { model: req.model, messages: req.messages.map(toWireMessage) };
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.topP !== undefined) body.top_p = req.topP;
  if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
  if (req.stopSequences?.length) body.stop = req.stopSequences;
  if (req.seed !== undefined) body.seed = req.seed;
  if (req.reasoningEffort && req.reasoningEffort !== "none") {
    if (kind === "openrouter") body.reasoning = { effort: req.reasoningEffort };
    else body.reasoning_effort = req.reasoningEffort;
  }
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
    if (req.toolChoice) body.tool_choice = req.toolChoice;
  }
  if (req.jsonSchema) {
    body.response_format = { type: "json_schema", json_schema: { name: "workflow_output", strict: false, schema: req.jsonSchema } };
  } else if (req.jsonMode) {
    body.response_format = { type: "json_object" };
  }
  return body;
}

type WireToolCall = { index?: number; id?: string; function?: { name?: string; arguments?: string } };

/** Non-streaming `message.tool_calls` → our shape. Nameless entries are dropped (nothing to call). */
export function parseToolCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((c, i) => {
      const t = c as WireToolCall;
      return { id: t.id ?? `call_${i}`, name: t.function?.name ?? "", arguments: t.function?.arguments ?? "" };
    })
    .filter((c) => c.name);
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => (p as { text?: string }).text ?? "").join("");
  return "";
}

function readUsage(usage: unknown): ChatUsage {
  const u = usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number } | undefined;
  return { promptTokens: u?.prompt_tokens, completionTokens: u?.completion_tokens, totalTokens: u?.total_tokens, cost: u?.cost };
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
      choices?: { message?: { content?: unknown; reasoning?: string; tool_calls?: unknown }; finish_reason?: string }[];
      usage?: unknown;
    };
    const choice = d.choices?.[0];
    return {
      text: contentToText(choice?.message?.content),
      reasoning: choice?.message?.reasoning ?? "",
      toolCalls: parseToolCalls(choice?.message?.tool_calls),
      model: d.model ?? req.model,
      finishReason: choice?.finish_reason ?? null,
      usage: readUsage(d.usage),
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

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

export type ChatStreamEvent =
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  /** A tool call is being assembled; `arguments` arrive in fragments across many events. */
  | { type: "tool_call"; index: number };

/** Everything a stream accumulates; turns into a ChatResponse once the stream ends. */
export type StreamState = {
  text: string;
  reasoning: string;
  toolCalls: ToolCall[];
  model: string | null;
  finishReason: string | null;
  usage: ChatUsage;
};

export function createStreamState(): StreamState {
  return { text: "", reasoning: "", toolCalls: [], model: null, finishReason: null, usage: {} };
}

/**
 * Splits a raw SSE buffer into complete `data:` payloads and returns what is left over.
 * Frames are separated by a blank line; comment lines (`:` heartbeats) are ignored.
 */
export function splitSseFrames(buffer: string): { payloads: string[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";
  const payloads: string[] = [];
  for (const frame of parts) {
    const data = frame
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart())
      .join("\n");
    if (data) payloads.push(data);
  }
  return { payloads, rest };
}

/**
 * Applies one decoded SSE payload to the accumulator. Tool calls arrive as fragments keyed by
 * `index`, so name and arguments are concatenated across chunks.
 */
export function applyStreamChunk(state: StreamState, chunk: unknown, onEvent?: (e: ChatStreamEvent) => void): void {
  const c = chunk as {
    model?: string;
    usage?: unknown;
    choices?: { delta?: { content?: unknown; reasoning?: string; reasoning_content?: string; tool_calls?: unknown[] }; finish_reason?: string | null }[];
  };
  if (c.model) state.model = c.model;
  if (c.usage) state.usage = readUsage(c.usage);
  const choice = c.choices?.[0];
  if (!choice) return;
  if (choice.finish_reason) state.finishReason = choice.finish_reason;

  const delta = choice.delta;
  if (!delta) return;

  const textDelta = contentToText(delta.content);
  if (textDelta) {
    state.text += textDelta;
    onEvent?.({ type: "text", delta: textDelta });
  }
  const reasoningDelta = delta.reasoning ?? delta.reasoning_content ?? "";
  if (reasoningDelta) {
    state.reasoning += reasoningDelta;
    onEvent?.({ type: "reasoning", delta: reasoningDelta });
  }
  if (Array.isArray(delta.tool_calls)) {
    delta.tool_calls.forEach((raw, position) => {
      const t = raw as WireToolCall;
      const index = t.index ?? position;
      const existing = state.toolCalls[index] ?? { id: "", name: "", arguments: "" };
      state.toolCalls[index] = {
        id: t.id ?? existing.id,
        name: t.function?.name ? existing.name + t.function.name : existing.name,
        arguments: t.function?.arguments ? existing.arguments + t.function.arguments : existing.arguments,
      };
      onEvent?.({ type: "tool_call", index });
    });
  }
}

/** Drops holes and unnamed entries so callers get a dense, callable list. */
export function finishStreamState(state: StreamState, fallbackModel: string): ChatResponse {
  return {
    text: state.text,
    reasoning: state.reasoning,
    toolCalls: state.toolCalls.filter((c) => c?.name).map((c, i) => ({ ...c, id: c.id || `call_${i}` })),
    model: state.model ?? fallbackModel,
    finishReason: state.finishReason,
    usage: state.usage,
    raw: null,
  };
}

/**
 * Streaming chat completion. Calls `onEvent` for every delta and resolves with the assembled
 * response once the stream ends. `signal` lets the caller abort mid-stream (stop button).
 */
export async function streamChatCompletion(
  cfg: LlmClientConfig,
  req: ChatRequest,
  onEvent: (e: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<ChatResponse> {
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  signal?.addEventListener("abort", abort);
  const timer = setTimeout(abort, req.timeoutMs ?? 300_000);
  try {
    const open = (includeUsage: boolean) => {
      const body = buildChatBody(cfg.kind, req);
      body.stream = true;
      // Without this most OpenAI-compatible providers stream no usage at all, and everything that
      // counts tokens (the weekly quota) silently stays at zero.
      if (includeUsage) body.stream_options = { include_usage: true };
      return fetch(joinUrl(cfg.baseUrl, "chat/completions"), {
        method: "POST",
        headers: { ...headers(cfg), accept: "text/event-stream" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    };

    let res = await open(true);
    let errorBody = "";
    if (!res.ok) {
      errorBody = await res.text().catch(() => "");
      // A few gateways reject unknown request fields. Losing the usage numbers is better than
      // losing the answer, so drop the option and try once more.
      if (res.status === 400 && /stream_options|include_usage|unknown|unrecognized|extra|not allowed|not permitted/i.test(errorBody)) {
        res = await open(false);
        errorBody = res.ok ? "" : await res.text().catch(() => "");
      }
    }
    if (!res.ok || !res.body) {
      let data: unknown = null;
      try {
        data = JSON.parse(errorBody);
      } catch {
        /* non-JSON error body */
      }
      const msg = (data as { error?: { message?: string } } | null)?.error?.message ?? errorBody.slice(0, 300);
      throw new LlmError(`LLM stream failed (${res.status}): ${msg}`, res.status, data ?? errorBody);
    }

    const state = createStreamState();
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let done = false;
    while (!done) {
      const { value, done: streamDone } = await reader.read();
      if (streamDone) break;
      buffer += decoder.decode(value, { stream: true });
      const { payloads, rest } = splitSseFrames(buffer);
      buffer = rest;
      for (const payload of payloads) {
        if (payload === "[DONE]") {
          done = true;
          break;
        }
        try {
          applyStreamChunk(state, JSON.parse(payload), onEvent);
        } catch {
          // A provider that interleaves non-JSON keep-alives must not kill the turn.
        }
      }
    }
    await reader.cancel().catch(() => {});
    return finishStreamState(state, req.model);
  } catch (err) {
    if (err instanceof LlmError) throw err;
    if ((err as Error).name === "AbortError") throw new LlmError(signal?.aborted ? "LLM stream cancelled" : "LLM stream timed out");
    throw new LlmError(`LLM stream failed: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
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
    tools: has("tools"),
  };
}

/**
 * Tool support as a tri-state: `undefined` when the provider reports no parameter list at all
 * (generic endpoints). Agents need this distinction – a known-false model is unusable, an
 * unknown one is worth a try with a warning.
 */
export function modelToolSupport(model?: LlmModelInfo | null): boolean | undefined {
  const sp = model?.supportedParameters;
  return sp ? sp.includes("tools") : undefined;
}
