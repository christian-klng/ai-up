/** Detects embeddable video providers from a URL. Pure, usable on client and server. */
export type VideoSource = { provider: "youtube" | "vimeo"; embedId: string; embedUrl: string } | { provider: "url"; url: string };

export function detectVideoSource(raw: string): VideoSource | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname.replace(/^www\./, "").toLowerCase();

  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    const id = url.searchParams.get("v") ?? (url.pathname.startsWith("/embed/") || url.pathname.startsWith("/shorts/") || url.pathname.startsWith("/live/") ? url.pathname.split("/")[2] : null);
    if (id && /^[\w-]{6,}$/.test(id)) return { provider: "youtube", embedId: id, embedUrl: `https://www.youtube-nocookie.com/embed/${id}` };
  }
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    if (id && /^[\w-]{6,}$/.test(id)) return { provider: "youtube", embedId: id, embedUrl: `https://www.youtube-nocookie.com/embed/${id}` };
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const m = /\/(?:video\/)?(\d{5,})/.exec(url.pathname);
    if (m) return { provider: "vimeo", embedId: m[1], embedUrl: `https://player.vimeo.com/video/${m[1]}` };
  }
  return { provider: "url", url: url.toString() };
}

export function isDirectMediaUrl(raw: string, kind: "video" | "image"): boolean {
  const exts = kind === "video" ? /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i : /\.(jpe?g|png|gif|webp|avif|svg)(\?|#|$)/i;
  return exts.test(raw);
}
