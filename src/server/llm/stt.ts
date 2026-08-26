import { LlmError, type LlmClientConfig } from "@/server/llm/client";

/**
 * Speech-to-text against an OpenAI-compatible `/audio/transcriptions` endpoint
 * (OpenAI whisper-1/gpt-4o-transcribe, Groq, self-hosted faster-whisper servers).
 * Routers without that endpoint (e.g. OpenRouter) fail with a clear error.
 */

export type TranscriptionSegment = { start: number; end: number; text: string };

export type TranscriptionResult = {
  text: string;
  language: string | null;
  durationSeconds: number | null;
  segments: TranscriptionSegment[];
};

export type TranscriptionRequest = {
  model: string;
  buffer: Buffer;
  filename: string;
  mime: string;
  /** ISO 639-1 code; empty = auto-detect */
  language?: string;
  /** context hint (names, jargon) passed to the model */
  prompt?: string;
  timeoutMs?: number;
};

function buildForm(req: TranscriptionRequest, responseFormat: "verbose_json" | "json"): FormData {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(req.buffer)], { type: req.mime }), req.filename);
  form.append("model", req.model);
  form.append("response_format", responseFormat);
  if (req.language?.trim()) form.append("language", req.language.trim());
  if (req.prompt?.trim()) form.append("prompt", req.prompt.trim());
  return form;
}

/** Renders segments as readable markdown with a [m:ss] stamp roughly every 45 seconds. */
export function transcriptToMarkdown(result: TranscriptionResult): string {
  if (!result.segments.length) return result.text;
  const blocks: { start: number; parts: string[] }[] = [];
  for (const s of result.segments) {
    const last = blocks[blocks.length - 1];
    if (!last || s.start - last.start >= 45) blocks.push({ start: s.start, parts: [s.text] });
    else last.parts.push(s.text);
  }
  const stamp = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
  return blocks.map((b) => `**[${stamp(b.start)}]** ${b.parts.join(" ")}`).join("\n\n");
}

export async function transcribeAudio(cfg: LlmClientConfig, req: TranscriptionRequest): Promise<TranscriptionResult> {
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/audio/transcriptions`;
  const headers: Record<string, string> = { ...(cfg.extraHeaders ?? {}) };
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;

  const attempt = async (responseFormat: "verbose_json" | "json") => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), req.timeoutMs ?? 300_000);
    try {
      const res = await fetch(url, { method: "POST", headers, body: buildForm(req, responseFormat), signal: ctrl.signal });
      const text = await res.text();
      let data: unknown = null;
      try {
        data = JSON.parse(text);
      } catch {
        /* non-JSON error body */
      }
      if (!res.ok) {
        const msg = (data as { error?: { message?: string } } | null)?.error?.message ?? text.slice(0, 300);
        throw new LlmError(`Transcription request failed (${res.status}): ${msg}`, res.status, data ?? text);
      }
      return data as { text?: string; language?: string; duration?: number; segments?: { start?: number; end?: number; text?: string }[] };
    } catch (err) {
      if (err instanceof LlmError) throw err;
      if ((err as Error).name === "AbortError") throw new LlmError("Transcription request timed out");
      throw new LlmError(`Transcription request failed: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  };

  let data: Awaited<ReturnType<typeof attempt>>;
  try {
    data = await attempt("verbose_json");
  } catch (err) {
    // some servers only implement the plain json format
    if (err instanceof LlmError && err.status === 400) data = await attempt("json");
    else throw err;
  }
  if (typeof data.text !== "string") throw new LlmError("Transcription response contained no text");
  return {
    text: data.text.trim(),
    language: data.language ?? null,
    durationSeconds: typeof data.duration === "number" ? Math.round(data.duration) : null,
    segments: (data.segments ?? [])
      .filter((s) => typeof s.text === "string")
      .map((s) => ({ start: Math.round((s.start ?? 0) * 10) / 10, end: Math.round((s.end ?? 0) * 10) / 10, text: (s.text ?? "").trim() })),
  };
}
