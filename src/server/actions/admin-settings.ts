"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/server/auth/auth";
import { assertAdmin } from "@/server/auth/session";
import { updateAppSettings } from "@/server/domain/settings";
import { approveUser, setUserRole, setUserStatus } from "@/server/domain/users";
import { IMAGE_MIMES, processAndStoreImage } from "@/server/media/images";
import { storeFile } from "@/server/media/storage";
import { isValidHexColor } from "@/lib/theme";
import { db } from "@/server/db/client";
import { auditLog } from "@/server/db/schema";
import { logger } from "@/server/logger";

export type AdminFormState = { status: "idle" } | { status: "saved" } | { status: "error"; message?: string };

// ---------------------------------------------------------------------------
// General & branding
// ---------------------------------------------------------------------------

const generalSchema = z.object({
  name: z.string().trim().min(1).max(80),
  tagline: z.string().trim().max(160).optional(),
  primaryColor: z.string().refine(isValidHexColor),
  radius: z.coerce.number().min(0).max(1.5),
  mode: z.enum(["light", "dark", "system"]),
  defaultLocale: z.enum(["de", "en"]),
});

export async function saveGeneralSettingsAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const admin = await assertAdmin();
  const parsed = generalSchema.safeParse({
    name: formData.get("name"),
    tagline: formData.get("tagline") || undefined,
    primaryColor: formData.get("primaryColor"),
    radius: formData.get("radius"),
    mode: formData.get("mode"),
    defaultLocale: formData.get("defaultLocale"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message };
  const { name, tagline, primaryColor, radius, mode, defaultLocale } = parsed.data;
  await updateAppSettings({ name, tagline: tagline ?? null, defaultLocale, theme: { primaryColor: primaryColor.toLowerCase(), radius, mode } });
  await db.insert(auditLog).values({ actorId: admin.id, action: "settings.general.updated", targetType: "settings", targetId: "default" });
  revalidatePath("/", "layout");
  return { status: "saved" };
}

const SVG_MAX = 512 * 1024;
const RASTER_MAX = 5 * 1024 * 1024;

/** Very small SVG sanitizer for admin-uploaded logos: rejects scripts/event handlers/external refs. */
function isSafeSvg(svg: string): boolean {
  const lower = svg.toLowerCase();
  return !/(<script|on[a-z]+\s*=|javascript:|<foreignobject|<iframe|xlink:href\s*=\s*["']?\s*(https?:|data:text)|href\s*=\s*["']?\s*javascript)/.test(lower);
}

export async function uploadBrandingImageAction(kind: "logo" | "favicon", _prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const admin = await assertAdmin();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { status: "error", message: "no file" };

  try {
    let mediaId: string;
    if (file.type === "image/svg+xml") {
      if (file.size > SVG_MAX) return { status: "error", message: "too large" };
      const text = await file.text();
      if (!isSafeSvg(text)) return { status: "error", message: "unsafe svg" };
      const media = await storeFile({ buffer: Buffer.from(text, "utf8"), mime: "image/svg+xml", originalName: file.name, purpose: kind, uploadedBy: admin.id });
      mediaId = media.id;
    } else if (kind === "favicon" && (file.type === "image/x-icon" || file.type === "image/vnd.microsoft.icon")) {
      if (file.size > RASTER_MAX) return { status: "error", message: "too large" };
      const media = await storeFile({ buffer: Buffer.from(await file.arrayBuffer()), mime: "image/x-icon", originalName: file.name, purpose: kind, uploadedBy: admin.id });
      mediaId = media.id;
    } else if (IMAGE_MIMES.has(file.type)) {
      if (file.size > RASTER_MAX) return { status: "error", message: "too large" };
      const media = await processAndStoreImage({
        buffer: Buffer.from(await file.arrayBuffer()),
        originalName: file.name,
        purpose: kind,
        uploadedBy: admin.id,
        maxEdge: kind === "favicon" ? 256 : 1024,
        square: kind === "favicon",
        thumbEdge: 64,
      });
      mediaId = media.id;
    } else {
      return { status: "error", message: "unsupported type" };
    }

    await updateAppSettings(kind === "logo" ? { logoMediaId: mediaId } : { faviconMediaId: mediaId });
    await db.insert(auditLog).values({ actorId: admin.id, action: `settings.${kind}.updated`, targetType: "media", targetId: mediaId });
    revalidatePath("/", "layout");
    return { status: "saved" };
  } catch (err) {
    logger.error({ err, kind }, "branding upload failed");
    return { status: "error", message: "upload failed" };
  }
}

export async function removeBrandingImageAction(kind: "logo" | "favicon"): Promise<void> {
  const admin = await assertAdmin();
  await updateAppSettings(kind === "logo" ? { logoMediaId: null } : { faviconMediaId: null });
  await db.insert(auditLog).values({ actorId: admin.id, action: `settings.${kind}.removed`, targetType: "settings", targetId: "default" });
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------------------
// Purpose
// ---------------------------------------------------------------------------

export async function savePurposeAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const admin = await assertAdmin();
  const purpose = z.string().trim().max(4000).safeParse(formData.get("purpose") ?? "");
  if (!purpose.success) return { status: "error" };
  await updateAppSettings({ purpose: purpose.data || null });
  await db.insert(auditLog).values({ actorId: admin.id, action: "settings.purpose.updated", targetType: "settings", targetId: "default" });
  revalidatePath("/", "layout");
  return { status: "saved" };
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export type MemberActionResult = { ok: true; name: string } | { ok: false; reason: "self" | "notFound" | "unexpected" };

export async function approveMemberAction(userId: string): Promise<MemberActionResult> {
  const admin = await assertAdmin();
  if (userId === admin.id) return { ok: false, reason: "self" };
  try {
    const hdrs = await headers();
    const user = await approveUser(userId, admin.id, async (email) => {
      // Send a first magic link straight away so the member can sign in from the approval mail.
      await auth.api.signInMagicLink({ headers: hdrs, body: { email, callbackURL: "/" } });
    });
    if (!user) return { ok: false, reason: "notFound" };
    revalidatePath("/admin/members");
    revalidatePath("/", "layout");
    return { ok: true, name: user.name };
  } catch (err) {
    logger.error({ err, userId }, "approve failed");
    return { ok: false, reason: "unexpected" };
  }
}

export async function setMemberStatusAction(userId: string, status: "active" | "suspended"): Promise<MemberActionResult> {
  const admin = await assertAdmin();
  if (userId === admin.id) return { ok: false, reason: "self" };
  const target = await db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, userId) });
  if (!target) return { ok: false, reason: "notFound" };
  await setUserStatus(userId, status, admin.id);
  revalidatePath("/admin/members");
  revalidatePath("/", "layout");
  return { ok: true, name: target.name };
}

export async function setMemberRoleAction(userId: string, role: "member" | "admin"): Promise<MemberActionResult> {
  const admin = await assertAdmin();
  if (userId === admin.id) return { ok: false, reason: "self" };
  const target = await db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, userId) });
  if (!target) return { ok: false, reason: "notFound" };
  await setUserRole(userId, role, admin.id);
  revalidatePath("/admin/members");
  return { ok: true, name: target.name };
}
