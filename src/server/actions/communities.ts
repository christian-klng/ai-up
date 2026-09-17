"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { COMMUNITY_COOKIE, COMMUNITY_COOKIE_OPTIONS } from "@/lib/community";
import { assertRootAdmin, assertUser } from "@/server/auth/session";
import {
  ROOT_COMMUNITY_ID,
  getMembership,
  communityUrl,
  loadCommunity,
  loadRootCommunity,
  restoreCommunity,
  softDeleteCommunity,
  updateCommunity,
} from "@/server/domain/communities";
import { primaryHostOf } from "@/server/domain/community-domains";
import { createCommunityWithSetup } from "@/server/domain/community-setup";
import { checkCommunitySlug, slugifyCommunityName } from "@/lib/community";
import { logger } from "@/server/logger";

/**
 * Switches the community the caller is acting in.
 *
 * The cookie is only ever set to a community the account is an active member of – the same check
 * `getActiveCommunity()` performs on every request, repeated here so a forged value never even
 * gets written.
 */
export type SwitchResult = { ok: false } | { ok: true; href: string; leaveApp: boolean };

export async function switchCommunityAction(communityId: string): Promise<SwitchResult> {
  const user = await assertUser();
  const id = z.string().min(1).max(64).parse(communityId);
  if (id === user.communityId) return { ok: true, href: "/home", leaveApp: false };

  const membership = await getMembership(id, user.id);
  if (!membership || membership.status !== "active") return { ok: false };
  (await cookies()).set(COMMUNITY_COOKIE, id, COMMUNITY_COOKIE_OPTIONS);
  revalidatePath("/", "layout");

  // With a host of its own the community *is* an address, so the switch has to leave this one – the
  // cookie alone would be overruled by the host we are still standing on. A custom domain needs the
  // hand-off on top, since the session cookie cannot follow across a registrable domain.
  //
  // `leaveApp` tells the browser to load the address properly instead of routing to it inside the
  // app: both targets are route handlers that answer with a redirect, and a client-side navigation
  // would fetch them as data and go nowhere.
  const target = await loadCommunity(id);
  if (!target) return { ok: true, href: "/home", leaveApp: false };
  const own = await primaryHostOf(id);
  if (own) return { ok: true, href: `/auth/handoff?to=${encodeURIComponent(own)}&next=%2Fhome`, leaveApp: true };
  const href = await communityUrl(target, "/home");
  return { ok: true, href, leaveApp: href.startsWith("http") || href.startsWith("/c/") };
}

// ---------------------------------------------------------------------------
// Creating
// ---------------------------------------------------------------------------

/**
 * May this account start a sub-community? The permission hangs off the **root** membership, not the
 * community someone happens to be looking at: admins of the installation always may, everyone else
 * only while the operator allows it. Sub-communities go exactly one level deep, so being an admin
 * of one grants nothing here.
 */
export async function canCreateCommunityAction(): Promise<boolean> {
  const user = await assertUser();
  const membership = await getMembership(ROOT_COMMUNITY_ID, user.id);
  if (!membership || membership.status !== "active") return false;
  if (membership.role === "admin") return true;
  return (await loadRootCommunity()).allowMemberSubcommunities;
}

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z.string().trim().min(3).max(40),
  purpose: z.string().trim().min(5).max(4000),
  locale: z.enum(["de", "en"]).default("de"),
});

export type CreateCommunityState =
  | { status: "idle" }
  | { status: "created"; slug: string }
  | { status: "error"; code: "notAllowed" | "slugTaken" | "slugInvalid" | "invalid" | "unexpected" };

export async function createCommunityAction(_prev: CreateCommunityState, formData: FormData): Promise<CreateCommunityState> {
  const user = await assertUser();
  if (!(await canCreateCommunityAction())) return { status: "error", code: "notAllowed" };

  const raw = {
    name: formData.get("name"),
    slug: String(formData.get("slug") ?? "").trim() || slugifyCommunityName(String(formData.get("name") ?? "")),
    purpose: formData.get("purpose"),
    locale: formData.get("locale") ?? "de",
  };
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) return { status: "error", code: "invalid" };
  const checked = checkCommunitySlug(parsed.data.slug);
  if (!checked.ok) return { status: "error", code: "slugInvalid" };

  try {
    const res = await createCommunityWithSetup(
      { name: parsed.data.name, slug: checked.slug, purpose: parsed.data.purpose, defaultLocale: parsed.data.locale },
      user.id,
    );
    if (!res.ok) return { status: "error", code: res.reason === "slugTaken" ? "slugTaken" : res.reason === "slugInvalid" ? "slugInvalid" : "notAllowed" };
    // The founder starts inside their new community.
    (await cookies()).set(COMMUNITY_COOKIE, res.community.id, COMMUNITY_COOKIE_OPTIONS);
    revalidatePath("/", "layout");
    return { status: "created", slug: res.community.slug };
  } catch (err) {
    logger.error({ err }, "creating a community failed");
    return { status: "error", code: "unexpected" };
  }
}

// ---------------------------------------------------------------------------
// Deleting
// ---------------------------------------------------------------------------

/**
 * Deletes the community the caller administers. It disappears immediately and is purged for good
 * after the grace period; until then a root admin can bring it back.
 */
export async function deleteOwnCommunityAction(confirmName: string): Promise<{ ok: boolean; reason?: "root" | "mismatch" | "notFound" }> {
  const user = await assertUser();
  if (user.role !== "admin") return { ok: false, reason: "notFound" };
  if (user.communityId === ROOT_COMMUNITY_ID) return { ok: false, reason: "root" };
  // Typing the name is the confirmation – this is the one action that takes everything with it.
  const row = await loadCommunity(user.communityId);
  if (!row || row.name.trim() !== confirmName.trim()) return { ok: false, reason: "mismatch" };

  const res = await softDeleteCommunity(user.communityId, user.id);
  if (!res.ok) return res;
  (await cookies()).set(COMMUNITY_COOKIE, ROOT_COMMUNITY_ID, COMMUNITY_COOKIE_OPTIONS);
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Operator view: delete or bring back any sub-community. */
export async function adminDeleteCommunityAction(communityId: string): Promise<{ ok: boolean }> {
  const admin = await assertRootAdmin();
  const res = await softDeleteCommunity(communityId, admin.id);
  revalidatePath("/admin/communities");
  revalidatePath("/", "layout");
  return { ok: res.ok };
}

export async function adminRestoreCommunityAction(communityId: string): Promise<{ ok: boolean }> {
  const admin = await assertRootAdmin();
  const ok = await restoreCommunity(communityId, admin.id);
  revalidatePath("/admin/communities");
  revalidatePath("/", "layout");
  return { ok };
}

/** Operator switch: may ordinary members of the root start their own communities? */
export async function setAllowSubcommunitiesAction(allow: boolean): Promise<{ ok: boolean }> {
  await assertRootAdmin();
  await updateCommunity(ROOT_COMMUNITY_ID, { allowMemberSubcommunities: allow });
  revalidatePath("/admin/general");
  revalidatePath("/", "layout");
  return { ok: true };
}
