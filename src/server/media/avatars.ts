import { createAvatar } from "@dicebear/core";
import { thumbs } from "@dicebear/collection";
import { storeFile } from "./storage";
import type { MediaFile } from "@/server/db/schema";

/**
 * Generates a deterministic, friendly avatar for a seed (+ optional salt) and stores it as SVG.
 * "thumbs" is neutral and works on light and dark backgrounds.
 *
 * `seed` and `uploadedBy` are separate on purpose: the picture of an AI agent is seeded with the
 * agent id, but media_files.uploaded_by is a foreign key to users – passing a non-user id there
 * fails the constraint.
 */
export async function generateRandomAvatar({ seed, salt = "", uploadedBy }: { seed: string; salt?: string; uploadedBy: string | null }): Promise<MediaFile> {
  const svg = createAvatar(thumbs, {
    seed: `${seed}:${salt}`,
    radius: 50,
    backgroundColor: ["dbeafe", "dcfce7", "fef3c7", "fce7f3", "e0e7ff", "ffedd5", "cffafe"],
    backgroundType: ["solid"],
  }).toString();

  return storeFile({
    buffer: Buffer.from(svg, "utf8"),
    mime: "image/svg+xml",
    originalName: "avatar.svg",
    purpose: "avatar",
    uploadedBy,
    width: 256,
    height: 256,
  });
}
