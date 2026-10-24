import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextRequest } from "next/server";
import { getAccount } from "@/server/auth/session";
import { getMembership } from "@/server/domain/communities";
import { absolutePath, getMedia } from "@/server/media/storage";
import { isPublishedEntryMedia } from "@/server/domain/posts";
import { PUBLIC_MEDIA_PURPOSES, mediaAccess } from "@/lib/media-access";

export const dynamic = "force-dynamic";

/**
 * Serves stored media. Branding assets, avatars, site-page images and meeting covers are public (login page, e-mails, OpenGraph);
 * everything else requires an active session **and** membership in the file's community – without
 * that check any member of any community could read every upload by its id.
 * Supports `?v=thumb` variants and HTTP Range for video/audio.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/files/[id]">) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("not found", { status: 404 });

  const media = await getMedia(id);
  if (!media) return new Response("not found", { status: 404 });

  // Images of published posts are public as long as a post shows them (docs/eigene-seiten.md 7.4);
  // asked only when the membership rule says no, so members keep their private caching.
  let publishedPost = false;
  if (!PUBLIC_MEDIA_PURPOSES.has(media.purpose)) {
    const user = await getAccount();
    const membership = user && media.communityId ? await getMembership(media.communityId, user.id) : undefined;
    const access = mediaAccess(media, user ? { signedIn: true, active: user.status === "active", memberOfCommunity: membership?.status === "active" } : { signedIn: false });
    if (access !== "allow") {
      publishedPost = await isPublishedEntryMedia(media.id);
      if (!publishedPost) return new Response(access === "unauthorized" ? "unauthorized" : "not found", { status: access === "unauthorized" ? 401 : 404 });
    }
  }

  const variant = req.nextUrl.searchParams.get("v") ?? undefined;
  const storagePath = (variant && media.variants[variant]) || media.storagePath;
  const abs = absolutePath(storagePath);
  const info = await stat(abs).catch(() => null);
  if (!info) return new Response("file missing", { status: 404 });

  const mime = variant && media.variants[variant] ? "image/webp" : media.mime;
  const headers = new Headers({
    "Content-Type": mime,
    // Post images stay public only while their post is published: short, revalidated cache.
    "Cache-Control": PUBLIC_MEDIA_PURPOSES.has(media.purpose) ? "public, max-age=31536000, immutable" : publishedPost ? "public, max-age=300" : "private, max-age=3600",
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
