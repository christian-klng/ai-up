import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { communities, mediaFiles, meetings, users } from "@/server/db/schema";
import { botUserId } from "@/lib/bot";
import { logger } from "@/server/logger";
import { deleteStoredFile } from "@/server/media/storage";
import { syncSchedules } from "@/server/workflows/queue";
import { ensureBotUser } from "./bot";
import { createCommunity, type CreateCommunityInput, type CreateCommunityResult } from "./communities";
import { createArea } from "./knowledge";
import { createSpace } from "./meetings";

/**
 * Creating and destroying a whole community, kept apart from `domain/communities.ts` so that module
 * stays free of the imports (agents, collections, meetings, the queue) that would make it circular.
 */

/**
 * One setup step. Each is isolated: a starter collection that fails must not cost the community its
 * assistant, and none of them may undo the community itself – the founder is already its admin and
 * can add by hand whatever did not appear.
 */
async function step(communityId: string, what: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    logger.error({ err, communityId, step: what }, "community setup step failed – the community exists and is usable");
  }
}

/** Starter content, so a new community is not an empty shell its founder has to furnish first. */
const STARTER = {
  de: {
    collection: { name: "Wissen", purpose: "Gesammeltes Wissen dieser Community – Anleitungen, Notizen, Links." },
    space: { name: "Treffen", purpose: "Regelmäßiger Austausch: Meetings, Termine, Protokolle." },
  },
  en: {
    collection: { name: "Knowledge", purpose: "What this community collects – guides, notes, links." },
    space: { name: "Meetings", purpose: "Getting together: meetings, dates, minutes." },
  },
} as const;

/**
 * Creates a sub-community and furnishes it: the founder becomes its admin, it gets its own system
 * agent and bot user, one collection and one meeting space.
 *
 * Everything after the community row itself is best effort – a failed starter collection must not
 * leave a half-created community behind that nobody can enter.
 */
export async function createCommunityWithSetup(input: CreateCommunityInput, founderId: string): Promise<CreateCommunityResult> {
  const created = await createCommunity(input, founderId);
  if (!created.ok) return created;
  const { community } = created;
  const texts = STARTER[community.defaultLocale];

  // Bot user first: the agent row carries a foreign key to it, and `ensureBotUser` creates the
  // agent itself once the user exists (domain/bot.ts). Calling ensureSystemAgent first fails.
  await step(community.id, "bot + agent", () => ensureBotUser(community.id));
  await step(community.id, "starter collection", () => createArea(community.id, { name: texts.collection.name, purpose: texts.collection.purpose }, founderId));
  await step(community.id, "starter meeting space", () => createSpace(community.id, { name: texts.space.name, purpose: texts.space.purpose }, founderId));
  return created;
}

/**
 * Removes a soft-deleted community for good.
 *
 * The database cascade takes the rows, but three things it cannot: the uploaded bytes on disk, the
 * repeatable jobs of this community's workflows, and the community's own bot user – an account row
 * that only the membership tied it to. Files are collected *before* the delete, because afterwards
 * there is no row left to find them by, and removed *after* it, so a failure half-way leaves
 * orphaned bytes rather than rows pointing at nothing.
 *
 * Avatars are spared: they have no community (`community_id` is null) and follow the person.
 */
export async function purgeCommunity(id: string): Promise<{ files: number }> {
  const community = await db.query.communities.findFirst({ where: eq(communities.id, id) });
  if (!community || !community.deletedAt) return { files: 0 };

  const files = await db.query.mediaFiles.findMany({
    where: eq(mediaFiles.communityId, id),
    columns: { id: true, storagePath: true, variants: true },
  });

  // End anything still running in the media server before the meetings disappear.
  const live = await db.query.meetings.findMany({ where: eq(meetings.status, "live") });
  if (live.length) {
    try {
      const [{ endRoom }, { getSpaceById }] = await Promise.all([import("@/server/meetings/livekit"), import("./meetings")]);
      for (const m of live) {
        if (await getSpaceById(id, m.spaceId)) await endRoom(m).catch(() => {});
      }
    } catch (err) {
      logger.warn({ err, communityId: id }, "could not close live rooms before purge");
    }
  }

  await db.delete(communities).where(eq(communities.id, id));

  // The bot is an `users` row, so no cascade reaches it. Its messages went with the conversations.
  await db.delete(users).where(eq(users.id, botUserId(id)));

  for (const f of files) await deleteStoredFile(f);
  // The workflows are gone, so their repeatable jobs have to go with them.
  await syncSchedules().catch((err) => logger.warn({ err }, "schedule resync after purge failed"));

  logger.info({ communityId: id, name: community.name, files: files.length }, "community purged");
  return { files: files.length };
}
