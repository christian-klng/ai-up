import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, open, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileTypeFromBuffer } from "file-type";
import { NextRequest } from "next/server";
import { db } from "@/server/db/client";
import { mediaFiles } from "@/server/db/schema";
import { getCurrentUser } from "@/server/auth/session";
import { env } from "@/server/env";
import { processAndStoreImage, IMAGE_MIMES } from "@/server/media/images";
import { absolutePath, extensionForMime, kindForMime, newStoragePath, uploadRoot, type MediaPurpose } from "@/server/media/storage";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ALLOWED: Record<string, Set<string>> = {
  content: new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm", "video/quicktime", "audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "application/pdf"]),
  message: new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"]),
};

/**
 * Raw-body upload (no multipart): the browser sends the file as request body with
 *   PUT /api/upload?purpose=content&name=<filename>
 * Data is streamed straight to a temp file on the volume (no buffering in memory), the real MIME type is
 * sniffed from the first bytes, images are re-encoded through the image pipeline, other media stays as-is.
 * Returns the media_files row summary.
 */
export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return Response.json({ error: "unauthorized" }, { status: 401 });

  const purpose = (req.nextUrl.searchParams.get("purpose") ?? "content") as MediaPurpose;
  const allowed = ALLOWED[purpose];
  if (!allowed) return Response.json({ error: "invalid purpose" }, { status: 400 });
  const originalName = (req.nextUrl.searchParams.get("name") ?? "upload").slice(0, 200);
  const maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > maxBytes) return Response.json({ error: "too_large", maxBytes }, { status: 413 });
  if (!req.body) return Response.json({ error: "empty body" }, { status: 400 });

  const tmpDir = path.join(/*turbopackIgnore: true*/ uploadRoot(), "tmp");
  await mkdir(tmpDir, { recursive: true });
  const tmpPath = path.join(/*turbopackIgnore: true*/ tmpDir, `${crypto.randomUUID()}.part`);

  let total = 0;
  const hash = createHash("sha256");
  let head: Buffer = Buffer.alloc(0);
  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      total += chunk.length;
      if (total > maxBytes) return cb(new Error("too_large"));
      hash.update(chunk);
      if (head.length < 4100) head = Buffer.concat([head, chunk]).subarray(0, 4100);
      cb(null, chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(req.body as import("stream/web").ReadableStream), meter, createWriteStream(tmpPath));
    if (total === 0) throw new Error("empty");

    // Trust magic bytes only – never the declared Content-Type (all allowed types are sniffable).
    const sniffed = await fileTypeFromBuffer(head);
    const mime = sniffed?.mime;
    if (!mime || !allowed.has(mime)) {
      await unlink(tmpPath).catch(() => {});
      return Response.json({ error: "unsupported_type", mime: mime ?? "unknown" }, { status: 415 });
    }

    // Images: run through the pipeline (re-encode, thumbnail). Fine for the typical size of images.
    if (IMAGE_MIMES.has(mime)) {
      const fh = await open(tmpPath, "r");
      const buf = await fh.readFile();
      await fh.close();
      await unlink(tmpPath).catch(() => {});
      const media = await processAndStoreImage({ buffer: buf, originalName, purpose, uploadedBy: user.id, maxEdge: 2048, thumbEdge: 320 });
      return Response.json(summary(media));
    }

    // Other media: move into place, record row.
    const id = crypto.randomUUID();
    const storagePath = newStoragePath(purpose, id, extensionForMime(mime, originalName));
    const abs = absolutePath(storagePath);
    await mkdir(path.dirname(abs), { recursive: true });
    await rename(tmpPath, abs);
    const size = (await stat(abs)).size;
    const [row] = await db
      .insert(mediaFiles)
      .values({ id, kind: kindForMime(mime), storagePath, originalName, mime, size, sha256: hash.digest("hex"), purpose, uploadedBy: user.id })
      .returning();
    return Response.json(summary(row));
  } catch (err) {
    await unlink(tmpPath).catch(() => {});
    const msg = err instanceof Error ? err.message : "upload failed";
    if (msg === "too_large") return Response.json({ error: "too_large", maxBytes }, { status: 413 });
    logger.error({ err }, "upload failed");
    return Response.json({ error: "upload_failed" }, { status: 500 });
  }
}

function summary(m: { id: string; kind: string; mime: string; size: number; width: number | null; height: number | null; originalName: string; variants: Record<string, string> }) {
  return {
    id: m.id,
    kind: m.kind,
    mime: m.mime,
    size: m.size,
    width: m.width,
    height: m.height,
    originalName: m.originalName,
    url: `/api/files/${m.id}`,
    thumbUrl: m.variants?.thumb ? `/api/files/${m.id}?v=thumb` : null,
  };
}
