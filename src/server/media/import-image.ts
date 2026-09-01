import { fileTypeFromBuffer } from "file-type";
import { env } from "@/server/env";
import { safeFetch } from "@/server/webreader/safe-fetch";
import { IMAGE_MIMES, processAndStoreImage } from "./images";
import type { MediaFile } from "@/server/db/schema";

export class ImageImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageImportError";
  }
}

/**
 * Imports an external image into media_files (SSRF-guarded, magic-bytes checked,
 * re-encoded with a thumb variant like /api/upload). Used by MCP entry images.
 */
export async function importImageFromUrl(url: string, uploadedBy: string): Promise<MediaFile> {
  const maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
  const res = await safeFetch(url, { maxBytes, timeoutMs: 15_000, headers: { accept: "image/*" } });
  if (res.status < 200 || res.status >= 300) throw new ImageImportError(`fetch failed with status ${res.status}`);
  if (res.truncated) throw new ImageImportError(`image exceeds ${env.MAX_UPLOAD_MB} MB`);
  if (res.body.length === 0) throw new ImageImportError("empty response");
  // Never trust the declared Content-Type — sniff the magic bytes (same rule as /api/upload).
  const detected = await fileTypeFromBuffer(res.body.subarray(0, 4100));
  if (!detected || !IMAGE_MIMES.has(detected.mime)) throw new ImageImportError("url does not point to a supported image (jpeg, png, webp, gif)");
  const name = decodeURIComponent(new URL(res.url).pathname.split("/").pop() || "") || "imported-image";
  return processAndStoreImage({ buffer: res.body, originalName: name, purpose: "content", uploadedBy, maxEdge: 2048, thumbEdge: 320 });
}
