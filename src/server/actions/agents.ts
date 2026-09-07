"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertUser } from "@/server/auth/session";
import { getAgentBySlug } from "@/server/domain/agents";
import { listAreas, listContents } from "@/server/domain/knowledge";
import { requestCancel, resolveToolCall } from "@/server/agents/loop";
import { getBudgetStatus } from "@/server/agents/usage";
import { toDto } from "@/server/agents/history";
import {
  addMessage,
  createThread,
  deleteThread,
  getOwnedThread,
  getMessage,
  getThreadConfig,
  hasRunningTurn,
  renameThread,
  setThreadCollections,
  setThreadInstructions,
  setThreadMode,
} from "@/server/agents/threads";
import { enqueueAgentTurn } from "@/server/workflows/queue";
import { publishToUser } from "@/server/realtime/publish";
import { logger } from "@/server/logger";
import type { AgentMessageDto } from "@/lib/realtime-events";

const sendSchema = z.string().trim().min(1).max(20_000);

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

const configSchema = z.object({
  mode: z.enum(["assist", "curate"]),
  readAreaIds: z.array(z.string().uuid()).max(50),
  writeAreaIds: z.array(z.string().uuid()).max(50),
  instructionContentIds: z.array(z.string().uuid()).max(20),
});

/**
 * Starts a conversation from the agent's start screen: creates the thread, applies the
 * configuration the member picked *before* sending, appends the message and hands the turn to the
 * worker. One action, so a half-created thread cannot stay behind if the member navigates away.
 */
export async function startThreadAction(
  agentSlug: string,
  body: string,
  config: { mode: "assist" | "curate"; readAreaIds: string[]; writeAreaIds: string[]; instructionContentIds: string[] },
): Promise<{ ok: true; threadId: string } | { ok: false; reason: "invalid" | "quota" }> {
  const me = await assertUser();
  const agent = await getAgentBySlug(agentSlug);
  if (!agent || !agent.enabled || (agent.ownerId && agent.ownerId !== me.id)) return { ok: false, reason: "invalid" };
  const parsedBody = sendSchema.safeParse(body);
  const parsedConfig = configSchema.safeParse(config);
  if (!parsedBody.success || !parsedConfig.success) return { ok: false, reason: "invalid" };
  if ((await getBudgetStatus(me.id)).exceeded) return { ok: false, reason: "quota" };

  const cfg = parsedConfig.data;
  const thread = await createThread(agent.id, me.id);
  if (cfg.readAreaIds.length || cfg.writeAreaIds.length) {
    await setThreadCollections(thread.id, cfg.readAreaIds, cfg.mode === "curate" ? cfg.writeAreaIds.filter((id) => cfg.readAreaIds.includes(id)) : []);
  }
  if (cfg.instructionContentIds.length) await setThreadInstructions(thread.id, cfg.instructionContentIds);
  if (cfg.mode !== "assist") await setThreadMode(thread.id, cfg.mode, "always");

  const message = await addMessage({ threadId: thread.id, role: "user", content: parsedBody.data, status: "complete" });
  await publishToUser(me.id, "agent.message.saved", { threadId: thread.id, message: toDto(message) });
  try {
    await enqueueAgentTurn(thread.id);
  } catch (err) {
    logger.error({ err, threadId: thread.id }, "could not enqueue agent turn");
    await publishToUser(me.id, "agent.turn.finished", { threadId: thread.id, status: "error", error: "queue unavailable" });
  }
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

/**
 * Appends the member's message and hands the turn to the worker. Long-running loops never run in a
 * request handler – see docs/ki-agenten.md 1.8.
 */
export async function sendAgentMessageAction(threadId: string, body: string): Promise<{ ok: true; message: AgentMessageDto } | { ok: false; reason: "invalid" | "busy" | "quota" }> {
  const owned = await ownThread(threadId);
  if (!owned) return { ok: false, reason: "invalid" };
  const parsed = sendSchema.safeParse(body);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  if (await hasRunningTurn(owned.thread.id)) return { ok: false, reason: "busy" };
  // The turn already running may still exceed the quota by at most maxTokensPerTurn – that cap is
  // what bounds the overshoot; starting a new turn over the limit is refused outright.
  if ((await getBudgetStatus(owned.me.id)).exceeded) return { ok: false, reason: "quota" };

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

/** The member's own quota state – shown as a percentage in the configuration panel. */
export async function getBudgetStatusAction(): Promise<{ budget: number; percent: number; exceeded: boolean; resetsAt: string }> {
  const me = await assertUser();
  const status = await getBudgetStatus(me.id);
  return { budget: status.budget, percent: status.percent, exceeded: status.exceeded, resetsAt: status.resetsAt.toISOString() };
}

/**
 * Approves or declines a parked write call. When the round has no pending calls left, the turn
 * continues where it stopped.
 */
export async function resolveToolCallAction(messageId: string, approve: boolean): Promise<{ ok: boolean }> {
  const me = await assertUser();
  const res = await resolveToolCall(z.string().uuid().parse(messageId), approve, me.id);
  if (!res.ok) return { ok: false };
  if (res.continued) {
    const message = await getMessage(z.string().uuid().parse(messageId));
    if (message) await enqueueAgentTurn(message.threadId);
  }
  return { ok: true };
}

export async function setThreadModeAction(threadId: string, mode: "assist" | "curate", writeApproval: "always" | "never"): Promise<{ ok: boolean }> {
  const owned = await ownThread(threadId);
  if (!owned) return { ok: false };
  const parsed = z.object({ mode: z.enum(["assist", "curate"]), writeApproval: z.enum(["always", "never"]) }).safeParse({ mode, writeApproval });
  if (!parsed.success) return { ok: false };
  await setThreadMode(owned.thread.id, parsed.data.mode, parsed.data.writeApproval);
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
