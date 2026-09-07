import { and, asc, eq, isNull, or } from "drizzle-orm";
import { db } from "@/server/db/client";
import { aiAgents, auditLog, users, type AiAgent } from "@/server/db/schema";
import { generateRandomAvatar } from "@/server/media/avatars";
import { logger } from "@/server/logger";
import { BOT_USER_ID } from "@/lib/bot";
import { SYSTEM_AGENT_ID, SYSTEM_AGENT_SLUG } from "@/lib/agents";
import { loadAppSettings } from "./settings";

export { SYSTEM_AGENT_ID, SYSTEM_AGENT_SLUG };

/**
 * Agents are the chat counterpart to workflows: an LLM with tools over the collections.
 * Exactly one row is the system agent – the default every member gets. Admins configure it
 * under Verwaltung → KI-Agenten; its name and avatar are mirrored onto the bot user so the
 * messenger (notifications from workflows) keeps showing the same identity.
 *
 * This module runs in the worker too – no next/* and no React imports.
 */

/**
 * Used whenever an agent has no own system prompt. English like every other LLM instruction in
 * the project (see evaluation.ts), with an explicit rule to answer in the user's language.
 * `{{ app.name }}` / `{{ app.purpose }}` are filled in by the context builder (phase C).
 */
export const DEFAULT_AGENT_SYSTEM_PROMPT = [
  'You are the assistant of "{{ app.name }}", a community workspace.',
  "{{ app.purpose }}",
  "",
  "Answer in the language the user writes in – German unless they switch.",
  "Be concise and concrete: no filler, no restating the question, no announcing what you are about to do.",
  "",
  "The community's knowledge lives in collections of structured entries. When a question touches that",
  "knowledge, look it up with your tools instead of guessing – list_entries and search_entries find",
  "entries, get_entry reads one in full. Say plainly when the collections do not cover something.",
  "",
  "When you use an entry, name it, so people can check and improve the source.",
  "Never invent entries, authors or facts about the community.",
].join("\n");

export async function listAgents(): Promise<AiAgent[]> {
  return db.query.aiAgents.findMany({ orderBy: [asc(aiAgents.createdAt)] });
}

/** Agents the member sees in the sidebar: the shared ones plus their own (phase F). */
export async function listAgentsForUser(userId: string): Promise<AiAgent[]> {
  return db.query.aiAgents.findMany({
    where: and(eq(aiAgents.enabled, true), or(isNull(aiAgents.ownerId), eq(aiAgents.ownerId, userId))),
    orderBy: [asc(aiAgents.createdAt)],
  });
}

export async function getAgentById(id: string): Promise<AiAgent | undefined> {
  return db.query.aiAgents.findFirst({ where: eq(aiAgents.id, id) });
}

export async function getAgentBySlug(slug: string): Promise<AiAgent | undefined> {
  return db.query.aiAgents.findFirst({ where: eq(aiAgents.slug, slug) });
}

/**
 * Loads the system agent, creating it if missing. The first creation inherits the name from the
 * (now deprecated) app_settings.bot_name so an existing installation keeps its bot identity, and
 * the picture from the bot user if it already had one.
 */
export async function ensureSystemAgent(): Promise<AiAgent> {
  let agent = await db.query.aiAgents.findFirst({ where: eq(aiAgents.id, SYSTEM_AGENT_ID) });
  if (!agent) {
    const settings = await loadAppSettings();
    const [created] = await db
      .insert(aiAgents)
      .values({ id: SYSTEM_AGENT_ID, slug: SYSTEM_AGENT_SLUG, name: settings.botName, isSystem: true, botUserId: BOT_USER_ID })
      .onConflictDoNothing()
      .returning();
    agent = created ?? (await db.query.aiAgents.findFirst({ where: eq(aiAgents.id, SYSTEM_AGENT_ID) }))!;
  }
  if (agent.avatarMediaId) return agent;

  // No picture yet: take the bot user's, otherwise generate one. Doing this here (rather than only
  // in ensureBotUser) means the agent has a face as soon as anyone opens it.
  const bot = await db.query.users.findFirst({ where: eq(users.id, BOT_USER_ID), columns: { avatarMediaId: true } });
  let avatarMediaId = bot?.avatarMediaId ?? null;
  if (!avatarMediaId) {
    try {
      // uploadedBy stays null: nobody uploaded this, it is generated – and media_files.uploaded_by
      // is a foreign key to users, which the agent id is not.
      avatarMediaId = (await generateRandomAvatar({ seed: SYSTEM_AGENT_ID, salt: "agent", uploadedBy: null })).id;
    } catch (err) {
      logger.warn({ err }, "agent avatar generation failed");
      return agent;
    }
  }
  const [updated] = await db.update(aiAgents).set({ avatarMediaId }).where(eq(aiAgents.id, agent.id)).returning();
  return updated ?? agent;
}

export type AgentInput = Partial<
  Pick<AiAgent, "name" | "description" | "avatarMediaId" | "providerId" | "model" | "systemPrompt" | "temperature" | "maxTokens" | "reasoningEffort" | "maxSteps" | "maxTokensPerTurn" | "enabled">
>;

export async function updateAgent(id: string, input: AgentInput, actorId: string): Promise<AiAgent | undefined> {
  const [row] = await db.update(aiAgents).set(input).where(eq(aiAgents.id, id)).returning();
  if (row) await db.insert(auditLog).values({ actorId, action: "agent.updated", targetType: "agent", targetId: id, details: { name: row.name } });
  return row;
}
