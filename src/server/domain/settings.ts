import { eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/server/db/client";
import { appSettings, type AppSettings, type ThemeSettings } from "@/server/db/schema";

export const DEFAULT_THEME: ThemeSettings = { primaryColor: "#2563eb", radius: 0.5, mode: "system" };

/**
 * Loads the singleton settings row (created by the seed). Memoized per request via React cache.
 */
export async function loadAppSettings(): Promise<AppSettings> {
  const row = await db.query.appSettings.findFirst({ where: eq(appSettings.id, "default") });
  if (row) return row;
  const [created] = await db.insert(appSettings).values({ id: "default" }).onConflictDoNothing().returning();
  return created ?? (await db.query.appSettings.findFirst({ where: eq(appSettings.id, "default") }))!;
}

/** Request-memoized variant for React Server Components; the worker uses `loadAppSettings()` directly. */
export const getAppSettings = cache(loadAppSettings);

export type UpdateSettingsInput = Partial<
  Pick<AppSettings, "name" | "tagline" | "purpose" | "logoMediaId" | "faviconMediaId" | "defaultLocale" | "theme">
>;

export async function updateAppSettings(input: UpdateSettingsInput): Promise<AppSettings> {
  const [row] = await db.update(appSettings).set(input).where(eq(appSettings.id, "default")).returning();
  return row;
}
