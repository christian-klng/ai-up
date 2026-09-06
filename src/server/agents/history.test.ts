import { describe, expect, it } from "vitest";
import { buildHistory, toDto } from "./history";
import type { AgentMessage } from "@/server/db/schema";

let seq = 0;
function msg(part: Partial<AgentMessage>): AgentMessage {
  return {
    id: part.id ?? `m${++seq}`,
    threadId: "t1",
    role: "user",
    content: "",
    toolCalls: null,
    toolCallId: null,
    toolName: null,
    status: "complete",
    error: null,
    usage: null,
    model: null,
    stepNo: 0,
    createdAt: new Date("2026-09-06T10:00:00Z"),
    ...part,
  } as AgentMessage;
}

describe("buildHistory", () => {
  it("keeps a plain exchange in order", () => {
    const history = buildHistory([
      msg({ role: "user", content: "Hallo" }),
      msg({ role: "assistant", content: "Hi" }),
    ]);
    expect(history).toEqual([
      { role: "user", content: "Hallo" },
      { role: "assistant", content: "Hi", toolCalls: undefined },
    ]);
  });

  it("replays a tool round with its result", () => {
    const history = buildHistory([
      msg({ role: "user", content: "Was steht in den Regeln?" }),
      msg({ id: "a1", role: "assistant", content: "", toolCalls: [{ id: "c1", name: "get_entry", arguments: '{"id":"7"}' }] }),
      msg({ role: "tool", content: "# Regeln", toolCallId: "c1", toolName: "get_entry" }),
      msg({ role: "assistant", content: "Dort steht …" }),
    ]);
    expect(history).toHaveLength(4);
    expect(history[1]).toEqual({ role: "assistant", content: "", toolCalls: [{ id: "c1", name: "get_entry", arguments: '{"id":"7"}' }] });
    expect(history[2]).toEqual({ role: "tool", content: "# Regeln", toolCallId: "c1" });
  });

  it("drops an assistant message whose tool call was never answered", () => {
    // A worker crash between the tool call and its result leaves exactly this shape; sending it
    // on would make the provider reject the whole request.
    const history = buildHistory([
      msg({ role: "user", content: "Frage" }),
      msg({ id: "a1", role: "assistant", content: "", toolCalls: [{ id: "c1", name: "get_entry", arguments: "{}" }] }),
    ]);
    expect(history).toEqual([{ role: "user", content: "Frage" }]);
  });

  it("drops the partial results of a half-answered call too", () => {
    const history = buildHistory([
      msg({ id: "a1", role: "assistant", content: "", toolCalls: [
        { id: "c1", name: "get_entry", arguments: "{}" },
        { id: "c2", name: "list_entries", arguments: "{}" },
      ] }),
      msg({ role: "tool", content: "result 1", toolCallId: "c1" }),
    ]);
    expect(history).toEqual([]);
  });

  it("ignores messages that failed, were cancelled or are still streaming", () => {
    const history = buildHistory([
      msg({ role: "user", content: "Frage" }),
      msg({ role: "assistant", content: "halb …", status: "cancelled" }),
      msg({ role: "assistant", content: "", status: "error", error: "boom" }),
      msg({ role: "assistant", content: "läuft", status: "streaming" }),
    ]);
    expect(history).toEqual([{ role: "user", content: "Frage" }]);
  });
});

describe("toDto", () => {
  it("serializes the timestamp and normalizes empty tool calls to null", () => {
    const dto = toDto(msg({ id: "x", role: "assistant", content: "Hi" }));
    expect(dto).toMatchObject({ id: "x", role: "assistant", content: "Hi", toolCalls: null, status: "complete" });
    expect(dto.createdAt).toBe("2026-09-06T10:00:00.000Z");
  });
});
