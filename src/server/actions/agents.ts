"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertUser } from "@/server/auth/session";
import { getAgentBySlug } from "@/server/domain/agents";
import { listAreas, listContents } from "@/server/domain/knowledge";
import { requestCancel } from "@/server/agents/loop";
import { toDto } from "@/server/agents/history";
import {
  addMessage,
  createThread,
  deleteThread,
  getOwnedThread,
  getThreadConfig,
  hasRunningTurn,
  renameThread,
  setThreadCollections,
  setThreadInstructions,
} from "@/server/agents/threads";
import { enqueueAgentTurn } from "@/server/workflows/queue";
import { publishToUser } from "@/server/realtime/publish";
import { logger } from "@/server/logger";
import type { AgentMessageDto } from "@/lib/realtime-events";

/** Every action re-checks ownership – a thread is private to the member who opened it. */
async function ownThread(threadId: string) {
  const me = await assertUser();
  const thread = await getOwnedThread(z.string().uuid().parse(threadId), me.id);
  return thread ? { me, thread } : null;
}

export async function createThreadAction(agentSlug: string): Promise<{ ok: true; threadId: string } | { ok: false }> {
  const me = await assertUser();
  const agent = await getAgentBySlug(agentSlug);
  if (!agent || !agent.enabled) return { ok: false };
  if (agent.ownerId && agent.ownerId !== me.id) return { ok: false };
  const thread = await createThread(agent.id, me.id);
  revalidatePath("/agents", "layout");
  return { ok: true, threadId: thread.id };
}

export async function deleteThreadAction(threadId: string): Promise<{ ok: boolean }> {
  const owned = await ownThread(threadId);
  if (!owned) return { ok: false };
  await deleteThread(owned.thread.id);
  revalidatePath("/agents", "layout");
  return { ok: true };
}

export async function renameThreadAction(threadId: string, title: string): Promise<{ ok: boolean }> {
  const owned = await ownThread(threadId);
  if (!owned) return { ok: false };
  await renameThread(owned.thread.id, z.string().trim().min(1).max(200).parse(title));
  revalidatePath("/agents", "layout");
  return { ok: true };
}

const sendSchema = z.string().trim().min(1).max(20_000);

/**
 * Appends the member's message and hands the turn to the worker. Long-running loops never run in a
 * request handler – see docs/ki-agenten.md 1.8.
 */
export async function sendAgentMessageAction(threadId: string, body: string): Promise<{ ok: true; message: AgentMessageDto } | { ok: false; reason: "invalid" | "busy" }> {
  const owned = await ownThread(threadId);
  if (!owned) return { ok: false, reason: "invalid" };
  const parsed = sendSchema.safeParse(body);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  if (await hasRunningTurn(owned.thread.id)) return { ok: false, reason: "busy" };

  const message = await addMessage({ threadId: owned.thread.id, role: "user", content: parsed.data, status: "complete" });
  const dto = toDto(message);
  await publishToUser(owned.me.id, "agent.message.saved", { threadId: owned.thread.id, message: dto });
  try {
    if ((await enqueueAgentTurn(owned.thread.id)) === "busy") return { ok: false, reason: "busy" };
  } catch (err) {
    logger.error({ err, threadId }, "could not enqueue agent turn");
    await publishToUser(owned.me.id, "agent.turn.finished", { threadId: owned.thread.id, status: "error", error: "queue unavailable" });
    return { ok: false, reason: "invalid" };
  }
  return { ok: true, message: dto };
}

export async function cancelAgentTurnAction(threadId: string): Promise<{ ok: boolean }> {
  const owned = await ownThread(threadId);
  if (!owned) return { ok: false };
  await requestCancel(owned.thread.id);
  return { ok: true };
}

export async function saveThreadConfigAction(
  threadId: string,
  input: { readAreaIds: string[]; writeAreaIds: string[]; instructionContentIds: string[] },
): Promise<{ ok: boolean }> {
  const owned = await ownThread(threadId);
  if (!owned) return { ok: false };
  const schema = z.object({
    readAreaIds: z.array(z.string().uuid()).max(50),
    writeAreaIds: z.array(z.string().uuid()).max(50),
    instructionContentIds: z.array(z.string().uuid()).max(20),
  });
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false };
  await setThreadCollections(owned.thread.id, parsed.data.readAreaIds, parsed.data.writeAreaIds);
  await setThreadInstructions(owned.thread.id, parsed.data.instructionContentIds);
  return { ok: true };
}

export async function getThreadConfigAction(threadId: string) {
  const owned = await ownThread(threadId);
  if (!owned) return null;
  return getThreadConfig(owned.thread.id);
}

/** Entry picker in the configuration panel: search across the collections, grouped by the caller. */
export async function searchEntriesAction(query: string): Promise<{ id: string; title: string; areaId: string; areaName: string }[]> {
  await assertUser();
  const q = z.string().trim().max(200).parse(query);
  const [areas, items] = await Promise.all([listAreas(), listContents({ query: q || undefined, limit: 40 })]);
  const names = new Map(areas.map((a) => [a.id, a.name]));
  return items.map((c) => ({ id: c.id, title: c.title, areaId: c.areaId, areaName: names.get(c.areaId) ?? "" }));
}
