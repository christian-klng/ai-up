import { getAgentById } from "@/server/domain/agents";
import { logger } from "@/server/logger";
import { getRedis } from "@/server/redis";
import { publishToUser } from "@/server/realtime/publish";
import { LlmError, modelCapabilities, streamChatCompletion, type ChatUsage } from "@/server/llm/client";
import { clientConfigFor, resolveModel } from "@/server/llm/providers";
import { buildSystemPrompt } from "./context";
import { buildHistory, toDto } from "./history";
import { addMessage, failStaleMessages, getThread, getThreadConfig, listMessages, renameThread, updateMessage } from "./threads";
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

export type TurnResult = { status: "done" | "error" | "cancelled" | "limit"; error: string | null };

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

  const agent = await getAgentById(thread.agentId);
  if (!agent) return finish({ status: "error", error: "agent not found" });

  try {
    const config = await getThreadConfig(threadId);
    const { prompt } = await buildSystemPrompt(agent, config.instructionContentIds);
    const tools = listTools(thread.mode === "curate" ? "write" : "read");
    const toolCtx: AgentToolContext = { userId, threadId, readAreaIds: config.readAreaIds, writeAreaIds: config.writeAreaIds };

    const { provider, model, info } = await resolveModel(agent.providerId, agent.model);
    const caps = modelCapabilities(info, provider.kind);
    const cfg = await clientConfigFor(provider);

    const stored = await listMessages(threadId);
    if (!thread.title) {
      const first = stored.find((m) => m.role === "user");
      if (first) await renameThread(threadId, first.content.replace(/\s+/g, " ").trim().slice(0, 80));
    }
    const history = buildHistory(stored);

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
            reasoningEffort: caps.reasoning ? agent.reasoningEffort ?? undefined : undefined,
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

      if (!res.toolCalls.length) return finish({ status: "done", error: null });

      for (const call of res.toolCalls) {
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

      const spent = usage.totalTokens ?? (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0);
      if (spent >= agent.maxTokensPerTurn) return finish({ status: "limit", error: null });
    }
    return finish({ status: "limit", error: null });
  } catch (err) {
    const message = (err as Error).message;
    logger.error({ err, threadId }, "agent turn crashed");
    return finish({ status: "error", error: message });
  }
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
