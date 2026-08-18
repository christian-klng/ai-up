import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { mediaFiles, type MediaFile } from "@/server/db/schema";
import { env } from "@/server/env";

export type MediaPurpose = "avatar" | "logo" | "favicon" | "content" | "message" | "recording";

const KIND_BY_MIME: Array<[RegExp, MediaFile["kind"]]> = [
  [/^image\//, "image"],
  [/^video\//, "video"],
  [/^audio\//, "audio"],
];

export function kindForMime(mime: string): MediaFile["kind"] {
  return KIND_BY_MIME.find(([re]) => re.test(mime))?.[1] ?? "file";
}

export function uploadRoot(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), env.UPLOAD_DIR);
}

export function absolutePath(storagePath: string): string {
  const abs = path.resolve(/*turbopackIgnore: true*/ uploadRoot(), storagePath);
  if (!abs.startsWith(uploadRoot())) throw new Error("invalid storage path");
  return abs;
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/webm": "weba",
  "audio/mp4": "m4a",
  "application/pdf": "pdf",
};

export function extensionForMime(mime: string, fallbackName?: string): string {
  if (EXT_BY_MIME[mime]) return EXT_BY_MIME[mime];
  const ext = fallbackName ? path.extname(fallbackName).replace(".", "").toLowerCase() : "";
  return ext && /^[a-z0-9]{1,8}$/.test(ext) ? ext : "bin";
}

export type StoreFileInput = {
  buffer: Buffer;
  mime: string;
  originalName: string;
  purpose: MediaPurpose;
  uploadedBy?: string | null;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  variants?: Record<string, string>;
};

/**
 * Persists a file under UPLOAD_DIR/<purpose>/<yyyy>/<mm>/<uuid>.<ext> and records it in media_files.
 * Files are immutable: updates always create a new media row (content history relies on this).
 */
export async function storeFile(input: StoreFileInput): Promise<MediaFile> {
  const id = crypto.randomUUID();
  const now = new Date();
  const dir = path.join(input.purpose, String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, "0"));
  const ext = extensionForMime(input.mime, input.originalName);
  const storagePath = path.join(/*turbopackIgnore: true*/ dir, `${id}.${ext}`);
  const abs = absolutePath(storagePath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, input.buffer);

  const sha256 = createHash("sha256").update(input.buffer).digest("hex");
  const [row] = await db
    .insert(mediaFiles)
    .values({
      id,
      kind: kindForMime(input.mime),
      storagePath,
      originalName: input.originalName.slice(0, 255),
      mime: input.mime,
      size: input.buffer.byteLength,
      sha256,
      width: input.width ?? null,
      height: input.height ?? null,
      durationSeconds: input.durationSeconds ?? null,
      variants: input.variants ?? {},
      purpose: input.purpose,
      uploadedBy: input.uploadedBy ?? null,
    })
    .returning();
  return row;
}

/** Stores a derived variant file (e.g. thumbnail) next to the original and returns its storage path. */
export async function storeVariant(original: MediaFile, variantName: string, buffer: Buffer, ext: string): Promise<string> {
  const base = original.storagePath.replace(/\.[a-z0-9]+$/i, "");
  const storagePath = `${base}.${variantName}.${ext}`;
  const abs = absolutePath(storagePath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, buffer);
  await db
    .update(mediaFiles)
    .set({ variants: { ...original.variants, [variantName]: storagePath } })
    .where(eq(mediaFiles.id, original.id));
  return storagePath;
}

export async function getMedia(id: string): Promise<MediaFile | undefined> {
  return db.query.mediaFiles.findFirst({ where: eq(mediaFiles.id, id) });
}

export async function readMediaFile(media: MediaFile, variant?: string): Promise<{ buffer: Buffer; size: number; path: string }> {
  const storagePath = (variant && media.variants[variant]) || media.storagePath;
  const abs = absolutePath(storagePath);
  const s = await stat(abs);
  return { buffer: await readFile(abs), size: s.size, path: abs };
}
