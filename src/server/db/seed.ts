import { eq } from "drizzle-orm";
import { env } from "@/server/env";
import type { Db } from "./client";
import { appSettings, users } from "./schema";

/**
 * Idempotent baseline seed:
 *  - ensures the singleton app_settings row exists
 *  - promotes SEED_ADMIN_EMAIL to an active admin (creates the user if missing)
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
}
