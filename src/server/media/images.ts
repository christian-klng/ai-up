import sharp from "sharp";
import { storeFile, storeVariant, type MediaPurpose } from "./storage";
import type { MediaFile } from "@/server/db/schema";

export const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/**
 * Re-encodes an uploaded raster image (strips metadata, guards against malformed files),
 * optionally resizes it, and stores it together with a small thumbnail variant.
 */
export async function processAndStoreImage(opts: {
  buffer: Buffer;
  originalName: string;
  purpose: MediaPurpose;
  uploadedBy?: string | null;
  /** Longest edge for the main image; omit to keep original size (max 4096). */
  maxEdge?: number;
  /** Square-crop (used for avatars) */
  square?: boolean;
  thumbEdge?: number;
}): Promise<MediaFile> {
  const maxEdge = Math.min(opts.maxEdge ?? 4096, 4096);
  const thumbEdge = opts.thumbEdge ?? 96;

  const base = sharp(opts.buffer, { failOn: "error", animated: false }).rotate();
  const meta = await base.metadata();
  if (!meta.width || !meta.height) throw new Error("unreadable image");

  let main = base.clone();
  if (opts.square) {
    main = main.resize({ width: maxEdge, height: maxEdge, fit: "cover", position: "attention", withoutEnlargement: true });
  } else {
    main = main.resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true });
  }
  const mainBuf = await main.webp({ quality: 86 }).toBuffer({ resolveWithObject: true });

  const media = await storeFile({
    buffer: mainBuf.data,
    mime: "image/webp",
    originalName: opts.originalName.replace(/\.[a-z0-9]+$/i, "") + ".webp",
    purpose: opts.purpose,
    uploadedBy: opts.uploadedBy,
    width: mainBuf.info.width,
    height: mainBuf.info.height,
  });

  const thumb = await sharp(mainBuf.data)
    .resize({ width: thumbEdge, height: thumbEdge, fit: opts.square ? "cover" : "inside" })
    .webp({ quality: 80 })
    .toBuffer();
  await storeVariant(media, "thumb", thumb, "webp");
  return { ...media, variants: { thumb: media.storagePath.replace(/\.[a-z0-9]+$/i, "") + ".thumb.webp" } };
}
