import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * SSRF-guarded fetch for user-supplied URLs (link previews, "read webpage" action, remote media checks).
 * - http/https only, no credentials in URL
 * - every hop (incl. redirects) must resolve to a public IP
 * - response size and time are capped
 */
export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

const PRIVATE_V4 = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^224\./,
  /^240\./,
  /^255\.255\.255\.255$/,
];

function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return PRIVATE_V4.some((re) => re.test(ip));
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::" ) return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
    if (lower.startsWith("fe80")) return true; // link-local
    if (lower.startsWith("::ffff:")) return isPrivateIp(lower.slice(7)); // mapped v4
    return false;
  }
  return true;
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("invalid url");
  }
  if (!/^https?:$/.test(url.protocol)) throw new UnsafeUrlError("only http(s) allowed");
  if (url.username || url.password) throw new UnsafeUrlError("credentials in url not allowed");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) throw new UnsafeUrlError("local host not allowed");
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new UnsafeUrlError("private address not allowed");
    return url;
  }
  const addrs = await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new UnsafeUrlError("host does not resolve");
  if (addrs.some((a) => isPrivateIp(a.address))) throw new UnsafeUrlError("host resolves to a private address");
  return url;
}

export type SafeFetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
  method?: "GET" | "HEAD";
};

export type SafeFetchResult = { url: string; status: number; contentType: string; body: Buffer; truncated: boolean };

export async function safeFetch(rawUrl: string, opts: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxBytes = opts.maxBytes ?? 2 * 1024 * 1024;
  const maxRedirects = opts.maxRedirects ?? 4;
  let current = await assertPublicUrl(rawUrl);

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(current, {
        method: opts.method ?? "GET",
        redirect: "manual",
        signal: ctrl.signal,
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; AI-Up/1.0; +https://github.com/ai-up)",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/*;q=0.8,*/*;q=0.5",
          "accept-language": "de,en;q=0.8",
          ...opts.headers,
        },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) throw new Error(`redirect without location (${res.status})`);
        current = await assertPublicUrl(new URL(loc, current).toString());
        continue;
      }
      const contentType = res.headers.get("content-type") ?? "application/octet-stream";
      if (opts.method === "HEAD" || !res.body) {
        return { url: current.toString(), status: res.status, contentType, body: Buffer.alloc(0), truncated: false };
      }
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      let truncated = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maxBytes) {
          chunks.push(value.subarray(0, value.byteLength - (total - maxBytes)));
          truncated = true;
          await reader.cancel().catch(() => {});
          break;
        }
        chunks.push(value);
      }
      return { url: current.toString(), status: res.status, contentType, body: Buffer.concat(chunks), truncated };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("too many redirects");
}
