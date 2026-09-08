import { getAgentById } from "@/server/domain/agents";
import { getUserById } from "@/server/domain/users";
import { getContent } from "@/server/domain/knowledge";
import { enqueueEvaluation } from "@/server/workflows/queue";
import { logger } from "@/server/logger";
import { getRedis } from "@/server/redis";
import { publishToUser } from "@/server/realtime/publish";
import { LlmError, streamChatCompletion, type ChatUsage } from "@/server/llm/client";
import { clientConfigFor, resolveModel } from "@/server/llm/providers";
import { normalizeReasoningLevel } from "@/server/llm/capabilities";
import { reportLlmError } from "@/server/llm/errors";
import { buildSystemPrompt } from "./context";
import { getBudgetStatus, weighUsage } from "./usage";
import { buildHistory, toDto } from "./history";
import { addMessage, failStaleMessages, getMessage, getThread, getThreadConfig, hasPendingApproval, listMessages, renameThread, updateMessage } from "./threads";
import { getTool, listTools, toolDefinitions, type AgentToolContext } from "./tools";

/**
 * The agentic loop: one turn = model call → tool calls → model call → … until the model answers
 * without asking for a tool, or a limit stops it. Runs in the worker (BullMQ), streams into the
 * chat over the user's realtime channel and can be cancelled from the UI.
 *
 * Limits are deliberate and hard (see docs/ki-agenten.md 1.7): a loop that runs in circles costs
 * the admin's API budget, so `maxSteps` and `maxTokensPerTurn` end the turn regardless of state.
 */

/** Token deltas are flushed on this interval – one realtime event per token would flood Redis. */
const FLUSH_MS = 120;
/** How often the loop asks Redis whether the user pressed stop while a stream is running. */
const CANCEL_POLL_MS = 1000;
const CANCEL_TTL_SECONDS = 900;

const cancelKey = (threadId: string) => `aiup-agent-cancel-${threadId}`;

export async function requestCancel(threadId: string): Promise<void> {
  await getRedis().set(cancelKey(threadId), "1", "EX", CANCEL_TTL_SECONDS);
}

async function isCancelled(threadId: string): Promise<boolean> {
  try {
    return (await getRedis().get(cancelKey(threadId))) !== null;
  } catch {
    // Redis hiccup must not abort a running turn.
    return false;
  }
}

async function clearCancel(threadId: string): Promise<void> {
  await getRedis().del(cancelKey(threadId)).catch(() => {});
}

function addUsage(total: ChatUsage, add: ChatUsage): ChatUsage {
  return {
    promptTokens: (total.promptTokens ?? 0) + (add.promptTokens ?? 0),
    completionTokens: (total.completionTokens ?? 0) + (add.completionTokens ?? 0),
    totalTokens: (total.totalTokens ?? 0) + (add.totalTokens ?? 0),
    cost: add.cost !== undefined || total.cost !== undefined ? (total.cost ?? 0) + (add.cost ?? 0) : undefined,
  };
}

/** Turns a provider error into something a member can act on. */
function explainLlmError(err: unknown): string {
  if (!(err instanceof LlmError)) return (err as Error).message;
  const body = typeof err.body === "string" ? err.body : JSON.stringify(err.body ?? "");
  if (/tool|function/i.test(body) && (err.status === 400 || err.status === 404)) {
    return `The selected model does not accept tools. Pick a different model under Admin → AI agents. (${err.message})`;
  }
  return err.message;
}

export type TurnResult = { status: "done" | "error" | "cancelled" | "limit" | "approval" | "quota"; error: string | null };

export async function runTurn(threadId: string): Promise<TurnResult> {
  const thread = await getThread(threadId);
  if (!thread) return { status: "error", error: "thread not found" };
  const userId = thread.userId;
  const finish = async (result: TurnResult): Promise<TurnResult> => {
    await clearCancel(threadId);
    await publishToUser(userId, "agent.turn.finished", { threadId, status: result.status, error: result.error });
    return result;
  };

  await clearCancel(threadId);
  await failStaleMessages(threadId, "The previous turn did not finish.");

  const [agent, owner] = await Promise.all([getAgentById(thread.agentId), getUserById(userId)]);
  if (!agent) return finish({ status: "error", error: "agent not found" });
  if (!owner || owner.status !== "active") return finish({ status: "error", error: "user not active" });

  try {
    const config = await getThreadConfig(threadId);
    const { prompt } = await buildSystemPrompt(agent, config.instructionContentIds);
    const tools = listTools(thread.mode === "curate" ? "write" : "read");
    const toolCtx: AgentToolContext = {
      userId,
      userRole: owner?.role ?? "member",
      threadId,
      agentId: agent.id,
      readAreaIds: config.readAreaIds,
      writeAreaIds: config.writeAreaIds,
      written: new Set<string>(),
    };

    const { provider, model, caps } = await resolveModel(agent.providerId, agent.model);
    const cfg = await clientConfigFor(provider);

    const stored = await listMessages(threadId);
    if (!thread.title) {
      const first = stored.find((m) => m.role === "user");
      if (first) await renameThread(threadId, first.content.replace(/\s+/g, " ").trim().slice(0, 80));
    }
    const history = buildHistory(stored);

    // Read once per turn, then keep adding this turn's own consumption: a query per step would
    // cost more than it protects.
    const budget = await getBudgetStatus(userId);
    if (budget.exceeded) return finish({ status: "quota", error: null });

    let usage: ChatUsage = {};
    for (let step = 0; step < agent.maxSteps; step++) {
      if (await isCancelled(threadId)) return finish({ status: "cancelled", error: null });

      const assistant = await addMessage({ threadId, role: "assistant", status: "streaming", stepNo: step, model });
      await publishToUser(userId, "agent.message.started", { threadId, message: toDto(assistant) });

      // Batch the token stream: one realtime event per token would flood Redis and every open tab.
      let pending = "";
      let streamed = "";
      let flushedAt = Date.now();
      const flush = async () => {
        if (!pending) return;
        const delta = pending;
        pending = "";
        flushedAt = Date.now();
        await publishToUser(userId, "agent.message.delta", { threadId, messageId: assistant.id, delta });
      };

      const ctrl = new AbortController();
      const poll = setInterval(() => {
        void isCancelled(threadId).then((c) => c && ctrl.abort());
      }, CANCEL_POLL_MS);

      let res;
      try {
        res = await streamChatCompletion(
          cfg,
          {
            model,
            messages: [{ role: "system", content: prompt }, ...history],
            tools: toolDefinitions(tools),
            temperature: caps.temperature && agent.temperature ? Number(agent.temperature) : undefined,
            maxTokens: caps.maxTokens ? agent.maxTokens ?? undefined : undefined,
            reasoningEffort: normalizeReasoningLevel(agent.reasoningEffort, caps),
          },
          (ev) => {
            if (ev.type !== "text") return;
            pending += ev.delta;
            streamed += ev.delta;
            if (Date.now() - flushedAt >= FLUSH_MS) void flush();
          },
          ctrl.signal,
        );
      } catch (err) {
        clearInterval(poll);
        if (await isCancelled(threadId)) {
          // Keep what the model had already written – a cut-off answer is still worth reading.
          const cancelled = await updateMessage(assistant.id, { status: "cancelled", content: streamed });
          if (cancelled) await publishToUser(userId, "agent.message.saved", { threadId, message: toDto(cancelled) });
          return finish({ status: "cancelled", error: null });
        }
        const message = explainLlmError(err);
        await reportLlmError(err, { provider, model, source: "agent", sourceId: threadId, actorId: userId, origin: { kind: "agent", threadId, agentId: agent.id, userId } });
        const saved = await updateMessage(assistant.id, { status: "error", error: message });
        if (saved) await publishToUser(userId, "agent.message.saved", { threadId, message: toDto(saved) });
        logger.warn({ err, threadId, agentId: agent.id }, "agent turn failed");
        return finish({ status: "error", error: message });
      } finally {
        clearInterval(poll);
      }
      await flush();

      usage = addUsage(usage, res.usage);
      const saved = await updateMessage(assistant.id, {
        content: res.text,
        toolCalls: res.toolCalls.length ? res.toolCalls : null,
        status: "complete",
        usage: res.usage,
        model: res.model,
      });
      if (saved) await publishToUser(userId, "agent.message.saved", { threadId, message: toDto(saved) });
      history.push({ role: "assistant", content: res.text, toolCalls: res.toolCalls.length ? res.toolCalls : undefined });

      if (!res.toolCalls.length) {
        await queueWrittenEvaluations(toolCtx);
        return finish({ status: "done", error: null });
      }

      // Write calls stop the turn for confirmation unless the thread runs unattended. Read calls
      // still execute – the model gets everything it can have without touching anything.
      const needsApproval = thread.mode === "curate" && thread.writeApproval === "always";
      let parked = false;
      for (const call of res.toolCalls) {
        const tool = getTool(call.name);
        if (needsApproval && tool?.access === "write") {
          const pending = await addMessage({
            threadId,
            role: "tool",
            content: describeCall(call),
            // The pending call is kept on the message so it can be executed after approval.
            toolCalls: [call],
            toolCallId: call.id,
            toolName: call.name,
            status: "awaiting_approval",
            stepNo: step,
          });
          await publishToUser(userId, "agent.message.saved", { threadId, message: toDto(pending) });
          parked = true;
          continue;
        }
        const output = await runTool(call, toolCtx);
        const toolMessage = await addMessage({
          threadId,
          role: "tool",
          content: output,
          toolCallId: call.id,
          toolName: call.name,
          status: "complete",
          stepNo: step,
        });
        await publishToUser(userId, "agent.message.saved", { threadId, message: toDto(toolMessage) });
        history.push({ role: "tool", content: output, toolCallId: call.id });
      }
      if (parked) {
        await queueWrittenEvaluations(toolCtx);
        return finish({ status: "approval", error: null });
      }

      const spent = usage.totalTokens ?? (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);
      if (spent >= agent.maxTokensPerTurn) {
        await queueWrittenEvaluations(toolCtx);
        return finish({ status: "limit", error: null });
      }
      if (budget.budget > 0 && budget.weighted + weighUsage(usage.promptTokens ?? 0, usage.completionTokens ?? 0, budget.outputWeight) >= budget.budget) {
        await queueWrittenEvaluations(toolCtx);
        return finish({ status: "quota", error: null });
      }
    }
    await queueWrittenEvaluations(toolCtx);
    return finish({ status: "limit", error: null });
  } catch (err) {
    const message = (err as Error).message;
    logger.error({ err, threadId }, "agent turn crashed");
    return finish({ status: "error", error: message });
  }
}

/**
 * One evaluation per entry the turn touched, at the end. Entry saves normally queue their own
 * check, but an agent turn can touch several entries – bundling keeps one chat sentence from
 * firing a burst of LLM calls (see docs/ki-agenten.md 1.5).
 */
async function queueWrittenEvaluations(ctx: AgentToolContext): Promise<void> {
  for (const contentId of ctx.written) {
    const entry = await getContent(contentId);
    if (entry?.type === "structured" && entry.currentVersionId) await enqueueEvaluation(contentId, entry.currentVersionId);
  }
  ctx.written.clear();
}

/** What the user is asked to confirm. Arguments are shown raw – they are the model's own words. */
function describeCall(call: { name: string; arguments: string }): string {
  let pretty = call.arguments;
  try {
    pretty = JSON.stringify(JSON.parse(call.arguments || "{}"), null, 2);
  } catch {
    /* keep the raw string – it is shown as-is */
  }
  return pretty;
}

/**
 * Runs a parked write call after the user approved it, or records the refusal. Returns whether the
 * thread may continue (no further pending approvals).
 */
export async function resolveToolCall(messageId: string, approve: boolean, userId: string): Promise<{ ok: boolean; continued: boolean }> {
  const message = await getMessage(messageId);
  if (!message || message.status !== "awaiting_approval") return { ok: false, continued: false };
  const thread = await getThread(message.threadId);
  if (!thread || thread.userId !== userId) return { ok: false, continued: false };
  const agent = await getAgentById(thread.agentId);
  const owner = await getUserById(userId);
  if (!agent || !owner) return { ok: false, continued: false };

  const call = message.toolCalls?.[0];
  let output: string;
  if (!approve) {
    output = "The user declined this action. Do not try it again; ask what to do instead.";
  } else if (!call) {
    output = "The pending call was lost and could not be executed.";
  } else {
    const config = await getThreadConfig(thread.id);
    const ctx: AgentToolContext = {
      userId,
      userRole: owner.role,
      threadId: thread.id,
      agentId: agent.id,
      readAreaIds: config.readAreaIds,
      writeAreaIds: config.writeAreaIds,
      written: new Set<string>(),
    };
    output = await runTool(call, ctx);
    await queueWrittenEvaluations(ctx);
  }

  const saved = await updateMessage(messageId, { content: output, status: "complete" });
  if (saved) await publishToUser(userId, "agent.message.saved", { threadId: thread.id, message: toDto(saved) });
  // Every parked call of the round has to be answered before the model may run again.
  const stillPending = await hasPendingApproval(thread.id);
  return { ok: true, continued: !stillPending };
}

/** Executes one tool call. Every failure becomes a readable tool result – the model may recover. */
async function runTool(call: { id: string; name: string; arguments: string }, ctx: AgentToolContext): Promise<string> {
  const tool = getTool(call.name);
  if (!tool) return `Unknown tool "${call.name}".`;
  let args: unknown;
  try {
    args = call.arguments.trim() ? JSON.parse(call.arguments) : {};
  } catch {
    return `The arguments of "${call.name}" were not valid JSON. Call the tool again with valid JSON.`;
  }
  const parsed = tool.schema.safeParse(args);
  if (!parsed.success) return `Invalid arguments for "${call.name}": ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`;
  try {
    return await tool.run(parsed.data, ctx);
  } catch (err) {
    logger.warn({ err, tool: call.name, threadId: ctx.threadId }, "agent tool failed");
    return `The tool "${call.name}" failed: ${(err as Error).message}`;
  }
}
