import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { safeFetch } from "./safe-fetch";

export type ReadWebpageResult = {
  url: string;
  finalUrl: string;
  title: string | null;
  byline: string | null;
  siteName: string | null;
  excerpt: string | null;
  lang: string | null;
  publishedAt: string | null;
  markdown: string;
  text: string;
  wordCount: number;
  truncated: boolean;
};

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
turndown.remove(["script", "style", "noscript", "iframe", "form", "nav", "footer", "aside"]);
turndown.remove((node) => node.nodeName.toLowerCase() === "svg");

/**
 * Downloads a page (SSRF-guarded) and extracts the human-readable article via Mozilla Readability.
 * Returns Markdown + plain text; boilerplate (nav, ads, cookie banners) is stripped.
 */
export async function readWebpage(url: string, opts: { maxChars?: number } = {}): Promise<ReadWebpageResult> {
  const maxChars = opts.maxChars ?? 60_000;
  const res = await safeFetch(url, { maxBytes: 5 * 1024 * 1024, timeoutMs: 25_000, headers: { accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8,*/*;q=0.5" } });
  const ct = res.contentType.toLowerCase();

  if (ct.startsWith("text/plain")) {
    const text = res.body.toString("utf8");
    return finish(url, res.url, null, null, null, null, null, null, text, text, maxChars);
  }
  if (!/html|xml/.test(ct)) throw new Error(`Unsupported content type: ${res.contentType}`);

  const html = decodeHtml(res.body, ct);
  const { document } = parseHTML(html);
  // Readability needs a base URI for relative links
  const base = document.createElement("base");
  base.setAttribute("href", res.url);
  document.head?.appendChild(base);

  const meta = (names: string[]) => {
    for (const n of names) {
      const el = document.querySelector(`meta[property="${n}"], meta[name="${n}"]`);
      const v = el?.getAttribute("content");
      if (v) return v.trim();
    }
    return null;
  };
  const lang = document.documentElement?.getAttribute("lang") ?? meta(["og:locale"]);
  const publishedAt = meta(["article:published_time", "datePublished", "date", "pubdate"]);
  const siteName = meta(["og:site_name"]) ?? new URL(res.url).hostname.replace(/^www\./, "");

  let article: ReturnType<Readability["parse"]> | null = null;
  try {
    // linkedom's Document is close enough to DOM for Readability
    article = new Readability(document as unknown as Document, { charThreshold: 200 }).parse();
  } catch {
    article = null;
  }

  const title = article?.title ?? meta(["og:title"]) ?? document.querySelector("title")?.textContent?.trim() ?? null;
  const contentHtml = article?.content ?? document.body?.innerHTML ?? "";
  let markdown = "";
  try {
    markdown = turndown.turndown(contentHtml);
  } catch {
    markdown = article?.textContent ?? "";
  }
  markdown = markdown.replace(/\n{3,}/g, "\n\n").trim();
  const text = (article?.textContent ?? document.body?.textContent ?? "").replace(/\s+/g, " ").trim();
  return finish(url, res.url, title, article?.byline ?? meta(["author"]), siteName, article?.excerpt ?? meta(["og:description", "description"]), lang, publishedAt, markdown, text, maxChars);
}

function finish(url: string, finalUrl: string, title: string | null, byline: string | null, siteName: string | null, excerpt: string | null, lang: string | null, publishedAt: string | null, markdown: string, text: string, maxChars: number): ReadWebpageResult {
  const truncated = markdown.length > maxChars || text.length > maxChars;
  const md = markdown.length > maxChars ? `${markdown.slice(0, maxChars)}\n\n[… truncated]` : markdown;
  const tx = text.length > maxChars ? `${text.slice(0, maxChars)} […]` : text;
  return { url, finalUrl, title, byline, siteName, excerpt, lang, publishedAt, markdown: md, text: tx, wordCount: text ? text.split(/\s+/).length : 0, truncated };
}

function decodeHtml(buf: Buffer, contentType: string): string {
  const m = /charset=([\w-]+)/i.exec(contentType);
  let charset = m?.[1]?.toLowerCase() ?? null;
  if (!charset) {
    const head = buf.subarray(0, 4096).toString("latin1");
    const mm = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head);
    charset = mm?.[1]?.toLowerCase() ?? "utf-8";
  }
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return buf.toString("utf8");
  }
}
