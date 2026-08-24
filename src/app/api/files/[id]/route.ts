import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextRequest } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { absolutePath, getMedia } from "@/server/media/storage";

export const dynamic = "force-dynamic";

const PUBLIC_PURPOSES = new Set(["logo", "favicon", "avatar", "landing"]);

/**
 * Serves stored media. Branding assets and avatars are public (needed on the login page and in e-mails);
 * everything else requires an active session. Supports `?v=thumb` variants and HTTP Range for video/audio.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/files/[id]">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("not found", { status: 404 });

  const media = await getMedia(id);
  if (!media) return new Response("not found", { status: 404 });

  if (!PUBLIC_PURPOSES.has(media.purpose)) {
    const user = await getCurrentUser();
    if (!user || user.status !== "active") return new Response("unauthorized", { status: 401 });
  }

  const variant = req.nextUrl.searchParams.get("v") ?? undefined;
  const storagePath = (variant && media.variants[variant]) || media.storagePath;
  const abs = absolutePath(storagePath);
  const info = await stat(abs).catch(() => null);
  if (!info) return new Response("file missing", { status: 404 });

  const mime = variant && media.variants[variant] ? "image/webp" : media.mime;
  const headers = new Headers({
    "Content-Type": mime,
    "Cache-Control": PUBLIC_PURPOSES.has(media.purpose) ? "public, max-age=31536000, immutable" : "private, max-age=3600",
    "Content-Disposition": `inline; filename="${encodeURIComponent(media.originalName)}"`,
    "X-Content-Type-Options": "nosniff",
    "Accept-Ranges": "bytes",
  });
  if (mime === "image/svg+xml") headers.set("Content-Security-Policy", "script-src 'none'; style-src 'unsafe-inline'");

  const range = req.headers.get("range");
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (m) {
      const start = m[1] ? Number(m[1]) : 0;
      const end = m[2] ? Math.min(Number(m[2]), info.size - 1) : Math.min(start + 1024 * 1024 * 4 - 1, info.size - 1);
      if (start <= end && start < info.size) {
        headers.set("Content-Range", `bytes ${start}-${end}/${info.size}`);
        headers.set("Content-Length", String(end - start + 1));
        const stream = Readable.toWeb(createReadStream(abs, { start, end })) as ReadableStream;
        return new Response(stream, { status: 206, headers });
      }
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${info.size}` } });
    }
  }

  headers.set("Content-Length", String(info.size));
  const stream = Readable.toWeb(createReadStream(abs)) as ReadableStream;
  return new Response(stream, { status: 200, headers });
}
