"use server";

import { revalidatePath } from "next/cache";
import { assertAdmin } from "@/server/auth/session";
import { updateAppSettings } from "@/server/domain/settings";
import { restoreLandingVersion } from "@/server/domain/landing";
import { db } from "@/server/db/client";
import { auditLog } from "@/server/db/schema";
import { logger } from "@/server/logger";
import type { AdminFormState } from "./admin-settings";

export async function setLandingEnabledAction(enabled: boolean): Promise<AdminFormState> {
  try {
    const admin = await assertAdmin();
    await updateAppSettings({ landingEnabled: enabled });
    await db.insert(auditLog).values({ actorId: admin.id, action: "settings.landing.toggled", targetType: "settings", targetId: "default", details: { enabled } });
    revalidatePath("/", "layout");
    return { status: "saved" };
  } catch (err) {
    logger.error({ err }, "toggle landing failed");
    return { status: "error" };
  }
}

export async function restoreLandingVersionAction(version: number): Promise<AdminFormState> {
  try {
    const admin = await assertAdmin();
    const row = await restoreLandingVersion(version, admin.id, "ui");
    if (!row) return { status: "error", message: "version not found" };
    await db.insert(auditLog).values({ actorId: admin.id, action: "landing.restored", targetType: "landing", targetId: row.id, details: { restored: version, newVersion: row.version } });
    revalidatePath("/", "layout");
    return { status: "saved" };
  } catch (err) {
    logger.error({ err, version }, "restore landing version failed");
    return { status: "error" };
  }
}
