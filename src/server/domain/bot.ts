import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { aiAgents, users, type MessageAttachment, type User } from "@/server/db/schema";
import { loadAppSettings } from "./settings";
import { ensureSystemAgent } from "./agents";
import { generateRandomAvatar } from "@/server/media/avatars";
import { getOrCreateDirectConversation, sendMessage } from "./messenger";
import { logger } from "@/server/logger";

/**
 * The system bot: a special user that sends messenger messages on behalf of workflows
 * (action `send_message`). It cannot log in (no sessions), is hidden from member lists and
 * needs no contact request – its conversations simply appear in the recipient's messenger.
 *
 * Members cannot write to it: the bot conversation is receive-only (see `sendMessage`),
 * conversational work happens with the AI agent instead.
 *
 * Name and avatar are owned by the system agent (`ai_agents`, see domain/agents.ts) and
 * mirrored onto this users row so messenger, member profiles and message history keep working.
 */
import { BOT_USER_ID } from "@/lib/bot";
export { BOT_USER_ID };
const BOT_EMAIL = "bot@system.local";

export async function ensureBotUser(): Promise<User> {
  const settings = await loadAppSettings();
  let bot = await db.query.users.findFirst({ where: eq(users.id, BOT_USER_ID) });
  if (!bot) {
    const [created] = await db
      .insert(users)
      .values({ id: BOT_USER_ID, email: BOT_EMAIL, name: settings.botName, emailVerified: true, role: "member", status: "active", isBot: true, locale: settings.defaultLocale })
      .onConflictDoNothing()
      .returning();
    bot = created ?? (await db.query.users.findFirst({ where: eq(users.id, BOT_USER_ID) }))!;
  }

  // The agent row is authoritative for name and avatar; it needs the users row to exist first (FK).
  const agent = await ensureSystemAgent();
  let avatarMediaId = agent.avatarMediaId;
  if (!avatarMediaId) {
    try {
      const avatar = await generateRandomAvatar(BOT_USER_ID, "bot");
      await db.update(aiAgents).set({ avatarMediaId: avatar.id }).where(eq(aiAgents.id, agent.id));
      avatarMediaId = avatar.id;
    } catch (err) {
      logger.warn({ err }, "bot avatar generation failed");
    }
  }
  if (bot.name !== agent.name || bot.avatarMediaId !== avatarMediaId) {
    const [updated] = await db.update(users).set({ name: agent.name, avatarMediaId }).where(eq(users.id, BOT_USER_ID)).returning();
    return updated;
  }
  return bot;
}

/** Sends a messenger message from the bot to a user (creates the direct conversation if needed). */
export async function sendBotMessage(userId: string, body: string, attachments: MessageAttachment[] = []): Promise<{ conversationId: string; messageId: string } | undefined> {
  const bot = await ensureBotUser();
  if (userId === bot.id) return undefined;
  const conv = await getOrCreateDirectConversation(bot.id, userId);
  const msg = await sendMessage({ id: bot.id, name: bot.name, avatarMediaId: bot.avatarMediaId }, conv.id, body, attachments);
  return msg ? { conversationId: conv.id, messageId: msg.id } : undefined;
}
