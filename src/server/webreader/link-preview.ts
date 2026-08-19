import type { LinkPreview } from "@/server/db/schema";
import { logger } from "@/server/logger";
import { safeFetch } from "./safe-fetch";

/**
 * Fetches Open Graph / basic metadata for a URL. Regex-based on purpose (no DOM dependency);
 * the full readable-text extraction lives in the workflow action "read_webpage" (Phase 5).
 */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ")
    .trim();
}

function metaContent(html: string, keys: string[]): string | undefined {
  for (const key of keys) {
    // <meta property="og:title" content="..."> or content first
    const re1 = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, "i");
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, "i");
    const m = re1.exec(html) ?? re2.exec(html);
    if (m?.[1]) return decodeEntities(m[1]);
  }
  return undefined;
}

export async function fetchLinkPreview(url: string): Promise<LinkPreview> {
  try {
    const res = await safeFetch(url, { maxBytes: 512 * 1024, timeoutMs: 8000 });
    if (!/text\/html|application\/xhtml/.test(res.contentType)) {
      return { title: new URL(res.url).hostname, fetchedAt: new Date().toISOString() };
    }
    const html = res.body.toString("utf8");
    const head = html.slice(0, 200_000);
    const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
    const title = metaContent(head, ["og:title", "twitter:title"]) ?? (titleTag ? decodeEntities(titleTag.replace(/\s+/g, " ")) : undefined);
    const description = metaContent(head, ["og:description", "twitter:description", "description"]);
    let image = metaContent(head, ["og:image", "og:image:url", "twitter:image"]);
    if (image) {
      try {
        image = new URL(image, res.url).toString();
      } catch {
        image = undefined;
      }
    }
    const siteName = metaContent(head, ["og:site_name"]) ?? new URL(res.url).hostname.replace(/^www\./, "");
    return { title: title?.slice(0, 300), description: description?.slice(0, 600), image, siteName, fetchedAt: new Date().toISOString() };
  } catch (err) {
    logger.warn({ err, url }, "link preview failed");
    let host = url;
    try {
      host = new URL(url).hostname;
    } catch {
      /* ignore */
    }
    return { title: host, fetchedAt: new Date().toISOString() };
  }
}
