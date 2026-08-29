"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertAdmin } from "@/server/auth/session";
import { updateAppSettings } from "@/server/domain/settings";
import { pageEnabledColumn, restoreLandingVersion, saveLandingVersion } from "@/server/domain/landing";
import { SITE_PAGES, type SitePage } from "@/lib/landing-schema";
import { db } from "@/server/db/client";
import { auditLog } from "@/server/db/schema";
import { logger } from "@/server/logger";
import type { AdminFormState } from "./admin-settings";

const pageSchema = z.enum(SITE_PAGES);

export async function setPageEnabledAction(page: SitePage, enabled: boolean): Promise<AdminFormState> {
  try {
    const admin = await assertAdmin();
    const p = pageSchema.parse(page);
    await updateAppSettings({ [pageEnabledColumn(p)]: enabled });
    await db.insert(auditLog).values({ actorId: admin.id, action: "settings.page.toggled", targetType: "settings", targetId: "default", details: { page: p, enabled } });
    revalidatePath("/", "layout");
    return { status: "saved" };
  } catch (err) {
    logger.error({ err, page }, "toggle page failed");
    return { status: "error" };
  }
}

export async function restoreLandingVersionAction(page: SitePage, version: number): Promise<AdminFormState> {
  try {
    const admin = await assertAdmin();
    const p = pageSchema.parse(page);
    const row = await restoreLandingVersion(p, version, admin.id, "ui");
    if (!row) return { status: "error", message: "version not found" };
    await db.insert(auditLog).values({ actorId: admin.id, action: "landing.restored", targetType: "landing", targetId: row.id, details: { page: p, restored: version, newVersion: row.version } });
    revalidatePath("/", "layout");
    return { status: "saved" };
  } catch (err) {
    logger.error({ err, page, version }, "restore page version failed");
    return { status: "error" };
  }
}

export type InlineSaveResult = { ok: true; version: number } | { ok: false; issues?: { path: string; message: string }[] };

/** Saves a definition edited in the admin inline editor as a new version (source "ui"). */
export async function saveLandingInlineAction(page: SitePage, definition: unknown): Promise<InlineSaveResult> {
  try {
    const admin = await assertAdmin();
    const p = pageSchema.parse(page);
    const res = await saveLandingVersion(p, definition, admin.id, "ui", "inline edit");
    if (!res.ok) return { ok: false, issues: res.issues };
    await db.insert(auditLog).values({ actorId: admin.id, action: "landing.updated", targetType: "landing", targetId: res.row.id, details: { page: p, version: res.row.version, via: "inline-editor" } });
    revalidatePath("/", "layout");
    return { ok: true, version: res.row.version };
  } catch (err) {
    logger.error({ err, page }, "inline page save failed");
    return { ok: false };
  }
}
