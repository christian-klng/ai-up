/**
 * Entries shown as posts on public pages (docs/eigene-seiten.md 7). Pure helpers shared by the
 * domain layer, the routes and the feed.
 */

const FILE_REF_RE = /\/api\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

/**
 * Uploads a version points at: every `/api/files/<id>` in its markdown (images, videos and files of
 * structured entries all render that way) plus the legacy media field. Exactly what a public post
 * page displays – nothing more becomes public through it.
 */
export function collectEntryMediaIds(bodyMarkdown: string | null | undefined, mediaId: string | null | undefined): string[] {
  const ids = new Set<string>();
  if (mediaId) ids.add(mediaId.toLowerCase());
  for (const m of (bodyMarkdown ?? "").matchAll(FILE_REF_RE)) ids.add(m[1].toLowerCase());
  return [...ids];
}

/** First image of a post (cover in card layouts), from markdown image syntax. */
export function firstImageMediaId(bodyMarkdown: string | null | undefined): string | null {
  const m = /!\[[^\]]*\]\(\/api\/files\/([0-9a-f-]{36})/i.exec(bodyMarkdown ?? "");
  return m ? m[1].toLowerCase() : null;
}

/**
 * Short plain-text teaser from markdown: the first paragraph that is prose (no heading, image,
 * list, table, code or mermaid), stripped of inline markup, cut at a word boundary.
 */
export function postExcerpt(bodyMarkdown: string | null | undefined, max = 220): string {
  const text = (bodyMarkdown ?? "").replace(/```[\s\S]*?```/g, "");
  for (const block of text.split(/\n\s*\n/)) {
    const b = block.trim();
    if (!b || /^(#|!\[|[-*+] |\d+\. |\||>|<)/.test(b)) continue;
    const plain = b
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[*_`~]+/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!plain) continue;
    if (plain.length <= max) return plain;
    const cut = plain.slice(0, max);
    return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 40)).trimEnd()} …`;
  }
  return "";
}
