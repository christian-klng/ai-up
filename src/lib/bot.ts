import { ROOT_COMMUNITY_SLUG } from "./community";

/**
 * Id of a community's system bot user (see src/server/domain/bot.ts). Client-safe.
 *
 * The root community keeps the historic id "system-bot" so its messenger history stays intact;
 * every other community gets its own bot, because name and avatar follow its own system agent.
 */
export const BOT_USER_ID = "system-bot";

export function botUserId(communityId: string): string {
  return communityId === ROOT_COMMUNITY_SLUG ? BOT_USER_ID : `system-bot-${communityId}`;
}
