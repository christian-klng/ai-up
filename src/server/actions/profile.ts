"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertUser } from "@/server/auth/session";
import { updateProfile } from "@/server/domain/users";
import { generateRandomAvatar } from "@/server/media/avatars";
import { IMAGE_MIMES, processAndStoreImage } from "@/server/media/images";
import { isLocale, LOCALE_COOKIE } from "@/i18n/config";
import { logger } from "@/server/logger";

export type ProfileFormState = { status: "idle" } | { status: "saved" } | { status: "error"; code: "photoTooLarge" | "photoInvalid" | "unexpected" };

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  bio: z.string().trim().max(500).optional(),
  locale: z.string(),
});

export async function updateProfileAction(_prev: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const user = await assertUser();
  const parsed = schema.safeParse({ name: formData.get("name"), bio: formData.get("bio") || undefined, locale: formData.get("locale") });
  if (!parsed.success) return { status: "error", code: "unexpected" };
  const locale = isLocale(parsed.data.locale) ? parsed.data.locale : user.locale;

  try {
    await updateProfile(user.id, { name: parsed.data.name, bio: parsed.data.bio ?? null, locale });
    (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    revalidatePath("/", "layout");
    return { status: "saved" };
  } catch (err) {
    logger.error({ err }, "profile update failed");
    return { status: "error", code: "unexpected" };
  }
}

export async function uploadProfilePhotoAction(_prev: ProfileFormState, formData: FormData): Promise<ProfileFormState> {
  const user = await assertUser();
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return { status: "error", code: "photoInvalid" };
  if (file.size > MAX_PHOTO_BYTES) return { status: "error", code: "photoTooLarge" };
  if (!IMAGE_MIMES.has(file.type)) return { status: "error", code: "photoInvalid" };

  try {
    const media = await processAndStoreImage({
      buffer: Buffer.from(await file.arrayBuffer()),
      originalName: file.name,
      purpose: "avatar",
      uploadedBy: user.id,
      maxEdge: 512,
      square: true,
      thumbEdge: 96,
    });
    await updateProfile(user.id, { avatarMediaId: media.id });
    revalidatePath("/", "layout");
    return { status: "saved" };
  } catch (err) {
    logger.error({ err }, "photo upload failed");
    return { status: "error", code: "photoInvalid" };
  }
}

export async function rerollAvatarAction(): Promise<void> {
  const user = await assertUser();
  const media = await generateRandomAvatar(user.id, crypto.randomUUID());
  await updateProfile(user.id, { avatarMediaId: media.id });
  revalidatePath("/", "layout");
}
