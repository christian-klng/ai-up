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
import { clientIp } from "@/lib/community-creation";
import { FORM_UPLOAD_MAX_MB, formImageKeys } from "@/lib/collection-forms";
import { issueUploadTicket, resolveForm, withinFormUploadLimit } from "@/server/domain/collection-forms";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ALLOWED: Record<string, Set<string>> = {
  content: new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm", "video/quicktime", "audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "application/pdf"]),
  message: new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"]),
  /** Landing page images are publicly served; upload is restricted to admins below. */
  landing: new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]),
  /** Meeting cover images are publicly served (OpenGraph); admins only. */
  meeting: new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]),
};

/** Images sent in through a collection's public form – the only upload without a session. */
const FORM_ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

type Uploader = { communityId: string; userId: string | null; purpose: MediaPurpose; allowed: Set<string>; maxBytes: number; ticketFor?: string };

/** Who is uploading: a signed-in member, or – with `?form=<token>` – a visitor of an open form that has an image field. */
async function resolveUploader(req: NextRequest): Promise<Uploader | Response> {
  const formToken = req.nextUrl.searchParams.get("form");
  if (formToken) {
    const resolved = await resolveForm(formToken);
    if (!resolved || formImageKeys(resolved.definition).length === 0) return Response.json({ error: "not_found" }, { status: 404 });
    if (!(await withinFormUploadLimit(resolved.form.id, clientIp(req.headers.get("x-forwarded-for"))))) return Response.json({ error: "rate_limited" }, { status: 429 });
    return { communityId: resolved.community.id, userId: null, purpose: "form", allowed: FORM_ALLOWED, maxBytes: Math.min(FORM_UPLOAD_MAX_MB, env.MAX_UPLOAD_MB) * 1024 * 1024, ticketFor: resolved.form.id };
  }
  const user = await getCurrentUser();
  if (!user || user.status !== "active") return Response.json({ error: "unauthorized" }, { status: 401 });
  const purpose = (req.nextUrl.searchParams.get("purpose") ?? "content") as MediaPurpose;
  const allowed = ALLOWED[purpose];
  if (!allowed) return Response.json({ error: "invalid purpose" }, { status: 400 });
  if ((purpose === "landing" || purpose === "meeting") && user.role !== "admin") return Response.json({ error: "forbidden" }, { status: 403 });
  return { communityId: user.communityId, userId: user.id, purpose, allowed, maxBytes: env.MAX_UPLOAD_MB * 1024 * 1024 };
}

/**
 * Raw-body upload (no multipart): the browser sends the file as request body with
 *   PUT /api/upload?purpose=content&name=<filename>
 * Data is streamed straight to a temp file on the volume (no buffering in memory), the real MIME type is
 * sniffed from the first bytes, images are re-encoded through the image pipeline, other media stays as-is.
 * Every file belongs to the community the uploader is acting in – without it the file is invisible to
 * community-scoped lists (site images) and, for non-public purposes, readable by any signed-in account.
 * Returns the media_files row summary.
 *
 * With `?form=<token>` the upload needs no session: a visitor of a collection's public form sends
 * an image for one of its image fields (docs/externe-formulare.md). Smaller limit, images only,
 * rate-limited per address; the file is not readable from outside and is swept away if it never
 * becomes part of a submission.
 */
export async function PUT(req: NextRequest) {
  const uploader = await resolveUploader(req);
  if (uploader instanceof Response) return uploader;
  const { purpose, allowed, maxBytes } = uploader;
  // Form uploads come back with a ticket: only whoever uploaded the file can attach it to a submission.
  const done = (m: Parameters<typeof summary>[0]) => Response.json(uploader.ticketFor ? { ...summary(m), ticket: issueUploadTicket(uploader.ticketFor, m.id) } : summary(m));
  const originalName = (req.nextUrl.searchParams.get("name") ?? "upload").slice(0, 200);
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
      const media = await processAndStoreImage({ buffer: buf, originalName, purpose, communityId: uploader.communityId, uploadedBy: uploader.userId, maxEdge: 2048, thumbEdge: 320 });
      return done(media);
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
      .values({ id, communityId: uploader.communityId, kind: kindForMime(mime), storagePath, originalName, mime, size, sha256: hash.digest("hex"), purpose, uploadedBy: uploader.userId })
      .returning();
    return done(row);
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
