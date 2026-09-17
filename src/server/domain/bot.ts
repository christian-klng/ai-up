import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { users, type MessageAttachment, type User } from "@/server/db/schema";
import { addMembership, loadCommunity } from "./communities";
import { ensureSystemAgent } from "./agents";
import { getOrCreateDirectConversation, sendMessage } from "./messenger";

/**
 * A community's system bot: a special user that sends messenger messages on behalf of workflows
 * (action `send_message`). It cannot log in (no sessions), is hidden from member lists and
 * needs no contact request – its conversations simply appear in the recipient's messenger.
 *
 * Members cannot write to it: the bot conversation is receive-only (see `sendMessage`),
 * conversational work happens with the AI agent instead.
 *
 * Name and avatar are owned by the system agent (`ai_agents`, see domain/agents.ts) and
 * mirrored onto this users row so messenger, member profiles and message history keep working.
 */
import { BOT_USER_ID, botUserId } from "@/lib/bot";
export { BOT_USER_ID, botUserId };
const botEmail = (communityId: string) => (communityId === "default" ? "bot@system.local" : `bot+${communityId}@system.local`);

export async function ensureBotUser(communityId: string): Promise<User> {
  const community = await loadCommunity(communityId);
  const id = botUserId(communityId);
  let bot = await db.query.users.findFirst({ where: eq(users.id, id) });
  if (!bot) {
    const [created] = await db
      .insert(users)
      .values({
        id,
        email: botEmail(communityId),
        name: community?.botName ?? "Assistent",
        emailVerified: true,
        status: "active",
        isBot: true,
        locale: community?.defaultLocale ?? "de",
      })
      .onConflictDoNothing()
      .returning();
    bot = created ?? (await db.query.users.findFirst({ where: eq(users.id, id) }))!;
  }
  // The bot needs a membership so it can hold conversations inside this community.
  await addMembership({ communityId, userId: id, status: "active" });

  // The agent row is authoritative for name and picture (it creates one if needed); this only mirrors.
  const agent = await ensureSystemAgent(communityId);
  if (bot.name !== agent.name || bot.avatarMediaId !== agent.avatarMediaId) {
    const [updated] = await db.update(users).set({ name: agent.name, avatarMediaId: agent.avatarMediaId }).where(eq(users.id, id)).returning();
    return updated;
  }
  return bot;
}

/** Sends a messenger message from the bot to a user (creates the direct conversation if needed). */
export async function sendBotMessage(communityId: string, userId: string, body: string, attachments: MessageAttachment[] = []): Promise<{ conversationId: string; messageId: string } | undefined> {
  const bot = await ensureBotUser(communityId);
  if (userId === bot.id) return undefined;
  const conv = await getOrCreateDirectConversation(communityId, bot.id, userId);
  const msg = await sendMessage({ id: bot.id, name: bot.name, avatarMediaId: bot.avatarMediaId }, conv.id, body, attachments);
  return msg ? { conversationId: conv.id, messageId: msg.id } : undefined;
}
