import type { AgentMessage } from "@/server/db/schema";
import type { ChatMessage } from "@/server/llm/client";
import type { AgentMessageDto } from "@/lib/realtime-events";

/**
 * Pure conversions between stored messages and the shapes the model resp. the UI expect.
 * Kept free of runtime imports so it can be unit tested (see history.test.ts).
 */

export function toDto(m: AgentMessage): AgentMessageDto {
  return {
    id: m.id,
    threadId: m.threadId,
    role: m.role,
    content: m.content,
    toolCalls: m.toolCalls ?? null,
    toolName: m.toolName,
    status: m.status,
    error: m.error,
    createdAt: m.createdAt.toISOString(),
  };
}

/**
 * Stored messages → wire history. Only completed messages are replayed, and an assistant message
 * whose tool results are missing (worker crash mid-turn) is dropped together with the partial
 * results: the API rejects a tool call that is never answered.
 */
export function buildHistory(messages: AgentMessage[]): ChatMessage[] {
  const complete = messages.filter((m) => m.status === "complete");
  const answered = new Set(complete.filter((m) => m.role === "tool" && m.toolCallId).map((m) => m.toolCallId as string));
  const dropped = new Set<string>();
  for (const m of complete) {
    if (m.role !== "assistant" || !m.toolCalls?.length) continue;
    if (!m.toolCalls.every((c) => answered.has(c.id))) {
      dropped.add(m.id);
      for (const c of m.toolCalls) answered.delete(c.id);
    }
  }
  const out: ChatMessage[] = [];
  for (const m of complete) {
    if (dropped.has(m.id)) continue;
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "assistant") out.push({ role: "assistant", content: m.content, toolCalls: m.toolCalls ?? undefined });
    else if (m.toolCallId && answered.has(m.toolCallId)) out.push({ role: "tool", content: m.content, toolCallId: m.toolCallId });
  }
  return out;
}
