import { and, asc, desc, eq, gt, or } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  agentMessages,
  agentThreadCollections,
  agentThreadInstructions,
  agentThreads,
  type AgentMessage,
  type AgentThread,
} from "@/server/db/schema";

/**
 * Threads are the agent's conversations. Deliberately not reusing conversations/messages:
 * those carry membership, unread counters and contact rules, while a thread carries tool calls,
 * its own configuration and a per-turn budget (see docs/ki-agenten.md 1.10).
 *
 * Runs in the worker too – no next/* imports.
 */

export type ThreadConfig = {
  /** collections the agent may read; empty = every collection */
  readAreaIds: string[];
  /** collections it may write (phase D) */
  writeAreaIds: string[];
  /** entries rendered into the system prompt, in order */
  instructionContentIds: string[];
};

export async function listThreads(userId: string, agentId: string): Promise<AgentThread[]> {
  return db.query.agentThreads.findMany({
    where: and(eq(agentThreads.userId, userId), eq(agentThreads.agentId, agentId)),
    orderBy: [desc(agentThreads.lastMessageAt), desc(agentThreads.createdAt)],
    limit: 200,
  });
}

export async function getThread(threadId: string): Promise<AgentThread | undefined> {
  return db.query.agentThreads.findFirst({ where: eq(agentThreads.id, threadId) });
}

/** Threads are private to their owner – every entry point goes through this. */
export async function getOwnedThread(threadId: string, userId: string): Promise<AgentThread | undefined> {
  const thread = await getThread(threadId);
  return thread && thread.userId === userId ? thread : undefined;
}

export async function createThread(agentId: string, userId: string): Promise<AgentThread> {
  const [row] = await db.insert(agentThreads).values({ agentId, userId }).returning();
  return row;
}

export async function deleteThread(threadId: string): Promise<void> {
  await db.delete(agentThreads).where(eq(agentThreads.id, threadId));
}

export async function renameThread(threadId: string, title: string): Promise<void> {
  await db.update(agentThreads).set({ title: title.slice(0, 200) }).where(eq(agentThreads.id, threadId));
}

export async function getThreadConfig(threadId: string): Promise<ThreadConfig> {
  const [areas, instructions] = await Promise.all([
    db.select().from(agentThreadCollections).where(eq(agentThreadCollections.threadId, threadId)),
    db.select().from(agentThreadInstructions).where(eq(agentThreadInstructions.threadId, threadId)).orderBy(asc(agentThreadInstructions.sortOrder)),
  ]);
  return {
    readAreaIds: areas.filter((a) => a.access === "read").map((a) => a.areaId),
    writeAreaIds: areas.filter((a) => a.access === "write").map((a) => a.areaId),
    instructionContentIds: instructions.map((i) => i.contentId),
  };
}

/** Replaces the collection selection wholesale (the panel always sends the full state). */
export async function setThreadCollections(threadId: string, read: string[], write: string[]): Promise<void> {
  const rows = [
    ...write.map((areaId) => ({ threadId, areaId, access: "write" as const })),
    // A collection selected for writing is readable anyway – never store it twice.
    ...read.filter((id) => !write.includes(id)).map((areaId) => ({ threadId, areaId, access: "read" as const })),
  ];
  await db.transaction(async (tx) => {
    await tx.delete(agentThreadCollections).where(eq(agentThreadCollections.threadId, threadId));
    if (rows.length) await tx.insert(agentThreadCollections).values(rows);
  });
}

export async function setThreadInstructions(threadId: string, contentIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(agentThreadInstructions).where(eq(agentThreadInstructions.threadId, threadId));
    if (contentIds.length) await tx.insert(agentThreadInstructions).values(contentIds.map((contentId, sortOrder) => ({ threadId, contentId, sortOrder })));
  });
}

export async function setThreadMode(threadId: string, mode: AgentThread["mode"], writeApproval: AgentThread["writeApproval"]): Promise<void> {
  await db.update(agentThreads).set({ mode, writeApproval }).where(eq(agentThreads.id, threadId));
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export async function listMessages(threadId: string): Promise<AgentMessage[]> {
  return db.query.agentMessages.findMany({ where: eq(agentMessages.threadId, threadId), orderBy: [asc(agentMessages.createdAt)], limit: 500 });
}

export async function getMessage(id: string): Promise<AgentMessage | undefined> {
  return db.query.agentMessages.findFirst({ where: eq(agentMessages.id, id) });
}

/** A parked write call blocks the turn until every one of them is approved or declined. */
export async function hasPendingApproval(threadId: string): Promise<boolean> {
  const rows = await db
    .select({ id: agentMessages.id })
    .from(agentMessages)
    .where(and(eq(agentMessages.threadId, threadId), eq(agentMessages.status, "awaiting_approval")))
    .limit(1);
  return rows.length > 0;
}

export async function addMessage(input: typeof agentMessages.$inferInsert): Promise<AgentMessage> {
  const [row] = await db.insert(agentMessages).values(input).returning();
  await db.update(agentThreads).set({ lastMessageAt: row.createdAt }).where(eq(agentThreads.id, row.threadId));
  return row;
}

export async function updateMessage(id: string, patch: Partial<typeof agentMessages.$inferInsert>): Promise<AgentMessage | undefined> {
  const [row] = await db.update(agentMessages).set(patch).where(eq(agentMessages.id, id)).returning();
  return row;
}

/**
 * True while a turn of this thread is still running – the composer stays disabled until it ends.
 * A `streaming` message older than the cutoff comes from a worker that died mid-turn; ignoring it
 * keeps a crash from locking the conversation forever.
 */
const STALE_TURN_MS = 10 * 60_000;

export async function hasRunningTurn(threadId: string): Promise<boolean> {
  const rows = await db
    .select({ id: agentMessages.id })
    .from(agentMessages)
    .where(
      and(
        eq(agentMessages.threadId, threadId),
        or(
          and(eq(agentMessages.status, "streaming"), gt(agentMessages.createdAt, new Date(Date.now() - STALE_TURN_MS))),
          eq(agentMessages.status, "awaiting_approval"),
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** A crashed worker leaves messages in `streaming`; the next turn marks them failed. */
export async function failStaleMessages(threadId: string, error: string): Promise<void> {
  await db.update(agentMessages).set({ status: "error", error }).where(and(eq(agentMessages.threadId, threadId), eq(agentMessages.status, "streaming")));
}
