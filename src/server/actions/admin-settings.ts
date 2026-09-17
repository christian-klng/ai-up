"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/server/auth/auth";
import { assertAdmin } from "@/server/auth/session";
import { isLastAdmin, loadCommunity, removeMembership, setMembershipRole, setMembershipStatus, updateCommunity } from "@/server/domain/communities";
import { getCommunityInvite, setCommunityInviteEnabled } from "@/server/domain/community-invites";
import { approveMember } from "@/server/domain/users";
import { IMAGE_MIMES, processAndStoreImage } from "@/server/media/images";
import { storeFile } from "@/server/media/storage";
import { communityPath } from "@/lib/community";
import { isValidHexColor } from "@/lib/theme";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLog, communityMembers, users } from "@/server/db/schema";
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
  await updateCommunity(admin.communityId, { name, tagline: tagline ?? null, defaultLocale, theme: { primaryColor: primaryColor.toLowerCase(), radius, mode } });
  await db.insert(auditLog).values({ communityId: admin.communityId, actorId: admin.id, action: "settings.general.updated", targetType: "settings", targetId: "default" });
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
      const media = await storeFile({ buffer: Buffer.from(text, "utf8"), mime: "image/svg+xml", originalName: file.name, purpose: kind, communityId: admin.communityId, uploadedBy: admin.id });
      mediaId = media.id;
    } else if (kind === "favicon" && (file.type === "image/x-icon" || file.type === "image/vnd.microsoft.icon")) {
      if (file.size > RASTER_MAX) return { status: "error", message: "too large" };
      const media = await storeFile({ buffer: Buffer.from(await file.arrayBuffer()), mime: "image/x-icon", originalName: file.name, purpose: kind, communityId: admin.communityId, uploadedBy: admin.id });
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

    await updateCommunity(admin.communityId, kind === "logo" ? { logoMediaId: mediaId } : { faviconMediaId: mediaId });
    await db.insert(auditLog).values({ communityId: admin.communityId, actorId: admin.id, action: `settings.${kind}.updated`, targetType: "media", targetId: mediaId });
    revalidatePath("/", "layout");
    return { status: "saved" };
  } catch (err) {
    logger.error({ err, kind }, "branding upload failed");
    return { status: "error", message: "upload failed" };
  }
}

export async function removeBrandingImageAction(kind: "logo" | "favicon"): Promise<void> {
  const admin = await assertAdmin();
  await updateCommunity(admin.communityId, kind === "logo" ? { logoMediaId: null } : { faviconMediaId: null });
  await db.insert(auditLog).values({ communityId: admin.communityId, actorId: admin.id, action: `settings.${kind}.removed`, targetType: "settings", targetId: "default" });
  revalidatePath("/", "layout");
}

// ---------------------------------------------------------------------------
// Purpose
// ---------------------------------------------------------------------------

export async function savePurposeAction(_prev: AdminFormState, formData: FormData): Promise<AdminFormState> {
  const admin = await assertAdmin();
  const purpose = z.string().trim().max(4000).safeParse(formData.get("purpose") ?? "");
  if (!purpose.success) return { status: "error" };
  await updateCommunity(admin.communityId, { purpose: purpose.data || null });
  await db.insert(auditLog).values({ communityId: admin.communityId, actorId: admin.id, action: "settings.purpose.updated", targetType: "settings", targetId: "default" });
  revalidatePath("/", "layout");
  return { status: "saved" };
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export type MemberActionResult =
  | { ok: true; name: string }
  | { ok: false; reason: "self" | "notFound" | "unexpected" | "lastAdmin" };

/**
 * Loads the target *as a member of the acting admin's community*. An id that belongs to no member
 * here answers "notFound" – an admin of one community can never reach into another.
 */
async function targetMember(communityId: string, userId: string): Promise<{ id: string; name: string } | undefined> {
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(communityMembers)
    .innerJoin(users, eq(users.id, communityMembers.userId))
    .where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.userId, userId)))
    .limit(1);
  return rows[0];
}

export async function approveMemberAction(userId: string): Promise<MemberActionResult> {
  const admin = await assertAdmin();
  if (userId === admin.id) return { ok: false, reason: "self" };
  try {
    const hdrs = await headers();
    const community = await loadCommunity(admin.communityId);
    // The link lands in the community they were just approved in, not in whichever one the browser
    // happens to remember (see lib/community.ts communityPath).
    const callbackURL = community ? communityPath(community.slug, "/home") : "/home";
    const user = await approveMember(admin.communityId, userId, admin.id, async (email) => {
      // Send a first magic link straight away so the member can sign in from the approval mail.
      await auth.api.signInMagicLink({ headers: hdrs, body: { email, callbackURL } });
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
  const target = await targetMember(admin.communityId, userId);
  if (!target) return { ok: false, reason: "notFound" };
  if (status === "suspended" && (await isLastAdmin(admin.communityId, userId))) return { ok: false, reason: "lastAdmin" };
  await setMembershipStatus(admin.communityId, userId, status, admin.id);
  revalidatePath("/admin/members");
  revalidatePath("/", "layout");
  return { ok: true, name: target.name };
}

export async function setMemberRoleAction(userId: string, role: "member" | "admin"): Promise<MemberActionResult> {
  const admin = await assertAdmin();
  if (userId === admin.id) return { ok: false, reason: "self" };
  const target = await targetMember(admin.communityId, userId);
  if (!target) return { ok: false, reason: "notFound" };
  if (role === "member" && (await isLastAdmin(admin.communityId, userId))) return { ok: false, reason: "lastAdmin" };
  await setMembershipRole(admin.communityId, userId, role, admin.id);
  revalidatePath("/admin/members");
  return { ok: true, name: target.name };
}

/**
 * Removes someone from this community. The account itself is untouched – they keep their profile and
 * any membership elsewhere. Refused for the last admin, who would otherwise orphan the community.
 */
export async function removeMemberAction(userId: string): Promise<MemberActionResult> {
  const admin = await assertAdmin();
  if (userId === admin.id) return { ok: false, reason: "self" };
  const target = await targetMember(admin.communityId, userId);
  if (!target) return { ok: false, reason: "notFound" };
  if (await isLastAdmin(admin.communityId, userId)) return { ok: false, reason: "lastAdmin" };
  await removeMembership(admin.communityId, userId, admin.id);
  revalidatePath("/admin/members");
  revalidatePath("/", "layout");
  return { ok: true, name: target.name };
}

// ---------------------------------------------------------------------------
// Join link
// ---------------------------------------------------------------------------

export type JoinLinkState = { url: string | null; enabled: boolean; useCount: number };

export async function getJoinLinkAction(): Promise<JoinLinkState> {
  const admin = await assertAdmin();
  const invite = await getCommunityInvite(admin.communityId);
  return { url: invite?.enabled ? invite.url : null, enabled: invite?.enabled ?? false, useCount: invite?.useCount ?? 0 };
}

/** Switches this community's join link on or off. While it is on, the URL creates active members. */
export async function setJoinLinkEnabledAction(enabled: boolean): Promise<{ ok: true; state: JoinLinkState } | { ok: false }> {
  const admin = await assertAdmin();
  try {
    const invite = await setCommunityInviteEnabled(admin.communityId, enabled, admin.id);
    revalidatePath("/admin/members");
    return { ok: true, state: { url: invite.enabled ? invite.url : null, enabled: invite.enabled, useCount: invite.useCount } };
  } catch (err) {
    logger.error({ err }, "toggling the join link failed");
    return { ok: false };
  }
}
