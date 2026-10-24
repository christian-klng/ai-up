"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
// The public pages belong to whoever owns a host: the root always, every community once
// sub-domains are switched on (see canManagePublicPages).
import { assertPagesAdmin } from "@/server/auth/session";
import { loadCommunity, updateCommunity } from "@/server/domain/communities";
import { pageEnabledColumn, pageLabel, restoreLandingVersion, saveLandingVersion, type PageRef } from "@/server/domain/landing";
import {
  createSitePageWithSetup,
  deleteSitePage,
  getSitePageById,
  moveSitePage,
  setSitePageEnabled,
  updateSitePageSettings,
  type SitePageError,
} from "@/server/domain/site-pages";
import { SITE_PAGES } from "@/lib/landing-schema";
import { SITE_PAGE_KINDS } from "@/lib/site-pages";
import { db } from "@/server/db/client";
import { auditLog } from "@/server/db/schema";
import { logger } from "@/server/logger";
import type { AdminFormState } from "./admin-settings";

/** A page as the admin UI addresses it: one of the fixed three or a custom page by id. */
export type PageKey = { fixed: (typeof SITE_PAGES)[number] } | { customId: string };

const pageKeySchema = z.union([z.object({ fixed: z.enum(SITE_PAGES) }), z.object({ customId: z.string().uuid() })]);

/** Resolves a key to a version target of the admin's community; undefined for a foreign or missing page. */
async function toRef(communityId: string, key: PageKey): Promise<PageRef | undefined> {
  const k = pageKeySchema.parse(key);
  if ("fixed" in k) return k.fixed;
  return (await getSitePageById(communityId, k.customId)) ? { sitePageId: k.customId } : undefined;
}

export async function setPageEnabledAction(key: PageKey, enabled: boolean): Promise<AdminFormState> {
  try {
    const admin = await assertPagesAdmin();
    const ref = await toRef(admin.communityId, key);
    if (!ref) return { status: "error", message: "page not found" };
    if (typeof ref === "string") await updateCommunity(admin.communityId, { [pageEnabledColumn(ref)]: enabled });
    else await setSitePageEnabled(admin.communityId, ref.sitePageId, enabled);
    await db.insert(auditLog).values({ communityId: admin.communityId, actorId: admin.id, action: "settings.page.toggled", targetType: "settings", targetId: "default", details: { page: pageLabel(ref), enabled } });
    revalidatePath("/", "layout");
    return { status: "saved" };
  } catch (err) {
    logger.error({ err, key }, "toggle page failed");
    return { status: "error" };
  }
}

export async function restoreLandingVersionAction(key: PageKey, version: number): Promise<AdminFormState> {
  try {
    const admin = await assertPagesAdmin();
    const ref = await toRef(admin.communityId, key);
    if (!ref) return { status: "error", message: "page not found" };
    const row = await restoreLandingVersion(admin.communityId, ref, version, admin.id, "ui");
    if (!row) return { status: "error", message: "version not found" };
    await db.insert(auditLog).values({ communityId: admin.communityId, actorId: admin.id, action: "landing.restored", targetType: "landing", targetId: row.id, details: { page: pageLabel(ref), restored: version, newVersion: row.version } });
    revalidatePath("/", "layout");
    return { status: "saved" };
  } catch (err) {
    logger.error({ err, key, version }, "restore page version failed");
    return { status: "error" };
  }
}

export type InlineSaveResult = { ok: true; version: number } | { ok: false; issues?: { path: string; message: string }[] };

/** Saves a definition edited in the admin inline editor as a new version (source "ui"). */
export async function saveLandingInlineAction(key: PageKey, definition: unknown): Promise<InlineSaveResult> {
  try {
    const admin = await assertPagesAdmin();
    const ref = await toRef(admin.communityId, key);
    if (!ref) return { ok: false };
    const res = await saveLandingVersion(admin.communityId, ref, definition, admin.id, "ui", "inline edit");
    if (!res.ok) return { ok: false, issues: res.issues };
    await db.insert(auditLog).values({ communityId: admin.communityId, actorId: admin.id, action: "landing.updated", targetType: "landing", targetId: res.row.id, details: { page: pageLabel(ref), version: res.row.version, via: "inline-editor" } });
    revalidatePath("/", "layout");
    return { ok: true, version: res.row.version };
  } catch (err) {
    logger.error({ err, key }, "inline page save failed");
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Custom pages (docs/eigene-seiten.md)
// ---------------------------------------------------------------------------

export type SitePageActionResult = { status: "saved"; id?: string } | { status: "error"; error?: SitePageError };

const createSchema = z.object({
  kind: z.enum(SITE_PAGE_KINDS),
  title: z.string(),
  slug: z.string(),
  showInNav: z.boolean(),
});

export async function createSitePageAction(input: z.infer<typeof createSchema>): Promise<SitePageActionResult> {
  try {
    const admin = await assertPagesAdmin();
    const data = createSchema.parse(input);
    const community = await loadCommunity(admin.communityId);
    if (!community) return { status: "error" };
    const res = await createSitePageWithSetup(community, data.kind, data, admin.id, "ui");
    if (!res.ok) return { status: "error", error: res.error };
    revalidatePath("/", "layout");
    return { status: "saved", id: res.page.id };
  } catch (err) {
    logger.error({ err }, "create site page failed");
    return { status: "error" };
  }
}

const settingsSchema = z.object({ title: z.string().optional(), slug: z.string().optional(), showInNav: z.boolean().optional() });

export async function updateSitePageAction(id: string, patch: z.infer<typeof settingsSchema>): Promise<SitePageActionResult> {
  try {
    const admin = await assertPagesAdmin();
    const res = await updateSitePageSettings(admin.communityId, z.string().uuid().parse(id), settingsSchema.parse(patch), admin.id);
    if (!res) return { status: "error" };
    if (!res.ok) return { status: "error", error: res.error };
    revalidatePath("/", "layout");
    return { status: "saved", id };
  } catch (err) {
    logger.error({ err, id }, "update site page failed");
    return { status: "error" };
  }
}

export async function moveSitePageAction(id: string, direction: "up" | "down"): Promise<SitePageActionResult> {
  try {
    const admin = await assertPagesAdmin();
    await moveSitePage(admin.communityId, z.string().uuid().parse(id), z.enum(["up", "down"]).parse(direction));
    revalidatePath("/", "layout");
    return { status: "saved", id };
  } catch (err) {
    logger.error({ err, id }, "move site page failed");
    return { status: "error" };
  }
}

export async function deleteSitePageAction(id: string): Promise<SitePageActionResult> {
  try {
    const admin = await assertPagesAdmin();
    const ok = await deleteSitePage(admin.communityId, z.string().uuid().parse(id), admin.id);
    if (!ok) return { status: "error" };
    revalidatePath("/", "layout");
    return { status: "saved" };
  } catch (err) {
    logger.error({ err, id }, "delete site page failed");
    return { status: "error" };
  }
}
