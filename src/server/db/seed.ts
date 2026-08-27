import { eq } from "drizzle-orm";
import { SYSTEM_TEMPLATES } from "@/lib/structures/defaults";
import { env } from "@/server/env";
import type { Db } from "./client";
import { appSettings, contentTemplates, contentTemplateVersions, users } from "./schema";

/**
 * Idempotent baseline seed:
 *  - ensures the singleton app_settings row exists
 *  - promotes SEED_ADMIN_EMAIL to an active admin (creates the user if missing)
 *  - creates/updates the system content templates (defaults.ts is authoritative)
 */
export async function seed(db: Db) {
  await db
    .insert(appSettings)
    .values({ id: "default", defaultLocale: env.DEFAULT_LOCALE })
    .onConflictDoNothing();

  if (env.SEED_ADMIN_EMAIL) {
    const email = env.SEED_ADMIN_EMAIL.toLowerCase();
    const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (!existing) {
      await db.insert(users).values({
        id: crypto.randomUUID(),
        email,
        name: "Admin",
        emailVerified: true,
        role: "admin",
        status: "active",
        locale: env.DEFAULT_LOCALE,
        approvedAt: new Date(),
      });
      console.log(`[seed] created admin user ${email}`);
    } else if (existing.role !== "admin" || existing.status !== "active") {
      await db
        .update(users)
        .set({ role: "admin", status: "active", approvedAt: existing.approvedAt ?? new Date() })
        .where(eq(users.id, existing.id));
      console.log(`[seed] promoted ${email} to active admin`);
    }
  }

  // System bot (sender of workflow chat messages) – idempotent
  await db
    .insert(users)
    .values({ id: "system-bot", email: "bot@system.local", name: "Assistent", emailVerified: true, role: "member", status: "active", isBot: true, locale: env.DEFAULT_LOCALE })
    .onConflictDoNothing();

  // System content templates: insert missing ones; when a definition in
  // defaults.ts changed, bump the version and append a snapshot row so
  // existing entries pick the update up via the template-upgrade flow.
  // Compare with sorted keys – jsonb does not preserve key order.
  const stable = (v: unknown): string => JSON.stringify(v, (_key, value) => (typeof value === "object" && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : value));
  const locale = env.DEFAULT_LOCALE;
  for (const t of SYSTEM_TEMPLATES) {
    const definition = t.definition(locale);
    const existing = await db.query.contentTemplates.findFirst({ where: eq(contentTemplates.id, t.id) });
    if (!existing) {
      await db.insert(contentTemplates).values({
        id: t.id,
        name: t.name[locale],
        description: t.description[locale],
        icon: t.icon,
        definition,
        version: 1,
        isSystem: true,
        systemKey: t.systemKey,
      });
      await db.insert(contentTemplateVersions).values({ templateId: t.id, version: 1, definition, changeNote: "seed" });
      console.log(`[seed] created system template ${t.systemKey}`);
    } else if (stable(existing.definition) !== stable(definition)) {
      const version = existing.version + 1;
      await db
        .update(contentTemplates)
        .set({ name: t.name[locale], description: t.description[locale], icon: t.icon, definition, version, updatedAt: new Date() })
        .where(eq(contentTemplates.id, t.id));
      await db.insert(contentTemplateVersions).values({ templateId: t.id, version, definition, changeNote: "seed update" });
      console.log(`[seed] updated system template ${t.systemKey} to v${version}`);
    }
  }
}
