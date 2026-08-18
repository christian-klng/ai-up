import { createAvatar } from "@dicebear/core";
import { thumbs } from "@dicebear/collection";
import { storeFile } from "./storage";
import type { MediaFile } from "@/server/db/schema";

/**
 * Generates a deterministic, friendly avatar for a seed (user id + optional salt) and stores it as SVG.
 * "thumbs" is neutral and works on light and dark backgrounds.
 */
export async function generateRandomAvatar(userId: string, salt = ""): Promise<MediaFile> {
  const svg = createAvatar(thumbs, {
    seed: `${userId}:${salt}`,
    radius: 50,
    backgroundColor: ["dbeafe", "dcfce7", "fef3c7", "fce7f3", "e0e7ff", "ffedd5", "cffafe"],
    backgroundType: ["solid"],
  }).toString();

  return storeFile({
    buffer: Buffer.from(svg, "utf8"),
    mime: "image/svg+xml",
    originalName: "avatar.svg",
    purpose: "avatar",
    uploadedBy: userId,
    width: 256,
    height: 256,
  });
}
