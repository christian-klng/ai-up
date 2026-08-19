import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { users, type MessageAttachment, type User } from "@/server/db/schema";
import { loadAppSettings } from "./settings";
import { generateRandomAvatar } from "@/server/media/avatars";
import { getOrCreateDirectConversation, sendMessage } from "./messenger";
import { logger } from "@/server/logger";

/**
 * The system bot: a special user that sends messenger messages on behalf of workflows
 * (action `send_message`). It cannot log in (no sessions), is hidden from member lists and
 * needs no contact request – its conversations simply appear in the recipient's messenger.
 */
import { BOT_USER_ID } from "@/lib/bot";
export { BOT_USER_ID };
const BOT_EMAIL = "bot@system.local";

export async function ensureBotUser(): Promise<User> {
  const settings = await loadAppSettings();
  const existing = await db.query.users.findFirst({ where: eq(users.id, BOT_USER_ID) });
  if (existing) {
    if (existing.name !== settings.botName) {
      const [updated] = await db.update(users).set({ name: settings.botName }).where(eq(users.id, BOT_USER_ID)).returning();
      return updated;
    }
    return existing;
  }
  const [created] = await db
    .insert(users)
    .values({ id: BOT_USER_ID, email: BOT_EMAIL, name: settings.botName, emailVerified: true, role: "member", status: "active", isBot: true, locale: settings.defaultLocale })
    .onConflictDoNothing()
    .returning();
  const bot = created ?? (await db.query.users.findFirst({ where: eq(users.id, BOT_USER_ID) }))!;
  if (!bot.avatarMediaId) {
    try {
      const avatar = await generateRandomAvatar(BOT_USER_ID, "bot");
      await db.update(users).set({ avatarMediaId: avatar.id }).where(eq(users.id, BOT_USER_ID));
      bot.avatarMediaId = avatar.id;
    } catch (err) {
      logger.warn({ err }, "bot avatar generation failed");
    }
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
