import { eq } from "drizzle-orm";
import { SYSTEM_TEMPLATES } from "@/lib/structures/defaults";
import { env } from "@/server/env";
import type { Db } from "./client";
import { SYSTEM_AGENT_ID, SYSTEM_AGENT_SLUG } from "@/lib/agents";
import { ROOT_COMMUNITY_ID, aiAgents, communities, communityMembers, contentTemplates, contentTemplateVersions, users } from "./schema";

/**
 * Idempotent baseline seed:
 *  - ensures the root community exists
 *  - promotes SEED_ADMIN_EMAIL to an active admin *of the root community* (creates the account if missing)
 *  - creates/updates the system content templates (defaults.ts is authoritative)
 *  - creates the system AI agent (name/avatar of the bot; see domain/agents.ts)
 */
export async function seed(db: Db) {
  await db
    .insert(communities)
    .values({ id: ROOT_COMMUNITY_ID, slug: ROOT_COMMUNITY_ID, defaultLocale: env.DEFAULT_LOCALE })
    .onConflictDoNothing();

  if (env.SEED_ADMIN_EMAIL) {
    const email = env.SEED_ADMIN_EMAIL.toLowerCase();
    let account = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (!account) {
      [account] = await db
        .insert(users)
        .values({ id: crypto.randomUUID(), email, name: "Admin", emailVerified: true, status: "active", locale: env.DEFAULT_LOCALE })
        .returning();
      console.log(`[seed] created admin account ${email}`);
    } else if (account.status !== "active") {
      await db.update(users).set({ status: "active" }).where(eq(users.id, account.id));
    }
    // Admin rights are a membership, not an account flag.
    await db
      .insert(communityMembers)
      .values({ communityId: ROOT_COMMUNITY_ID, userId: account.id, role: "admin", status: "active", approvedAt: new Date() })
      .onConflictDoUpdate({
        target: [communityMembers.communityId, communityMembers.userId],
        set: { role: "admin", status: "active" },
      });
    console.log(`[seed] ${email} is an active admin of the root community`);
  }

  // System bot of the root community (sender of workflow chat messages) – idempotent
  await db
    .insert(users)
    .values({ id: "system-bot", email: "bot@system.local", name: "Assistent", emailVerified: true, status: "active", isBot: true, locale: env.DEFAULT_LOCALE })
    .onConflictDoNothing();
  await db
    .insert(communityMembers)
    .values({ communityId: ROOT_COMMUNITY_ID, userId: "system-bot", status: "active" })
    .onConflictDoNothing();

  // System AI agent – owns name and avatar of the bot from here on. Inherits the name an existing
  // installation configured under app_settings.bot_name. Must run after the bot user (FK).
  const rootCommunity = await db.query.communities.findFirst({ where: eq(communities.id, ROOT_COMMUNITY_ID) });
  await db
    .insert(aiAgents)
    .values({ id: SYSTEM_AGENT_ID, communityId: ROOT_COMMUNITY_ID, slug: SYSTEM_AGENT_SLUG, name: rootCommunity?.botName ?? "Assistent", isSystem: true, botUserId: "system-bot" })
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
