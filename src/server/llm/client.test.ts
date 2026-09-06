import { describe, expect, it } from "vitest";
import {
  applyStreamChunk,
  buildChatBody,
  createStreamState,
  finishStreamState,
  parseToolCalls,
  splitSseFrames,
  type ChatStreamEvent,
} from "./client";

/** Feeds an SSE transcript through the accumulator the way streamChatCompletion does. */
function replay(raw: string, chunkSize = 7) {
  const state = createStreamState();
  const events: ChatStreamEvent[] = [];
  let buffer = "";
  for (let i = 0; i < raw.length; i += chunkSize) {
    buffer += raw.slice(i, i + chunkSize);
    const { payloads, rest } = splitSseFrames(buffer);
    buffer = rest;
    for (const p of payloads) {
      if (p === "[DONE]") continue;
      applyStreamChunk(state, JSON.parse(p), (e) => events.push(e));
    }
  }
  return { state, events };
}

describe("buildChatBody", () => {
  it("serializes tools and tool_choice", () => {
    const body = buildChatBody("openai", {
      model: "gpt-x",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "get_entry", description: "Read one entry", parameters: { type: "object", properties: { id: { type: "string" } } } }],
      toolChoice: "auto",
    });
    expect(body.tools).toEqual([
      { type: "function", function: { name: "get_entry", description: "Read one entry", parameters: { type: "object", properties: { id: { type: "string" } } } } },
    ]);
    expect(body.tool_choice).toBe("auto");
  });

  it("omits tool fields for a plain completion", () => {
    const body = buildChatBody("openai", { model: "gpt-x", messages: [{ role: "user", content: "hi" }] });
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });

  it("writes assistant tool calls and tool results in wire format", () => {
    const body = buildChatBody("openai", {
      model: "gpt-x",
      messages: [
        { role: "assistant", content: "", toolCalls: [{ id: "call_1", name: "get_entry", arguments: '{"id":"7"}' }] },
        { role: "tool", content: "# Title", toolCallId: "call_1" },
      ],
    });
    expect(body.messages).toEqual([
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "get_entry", arguments: '{"id":"7"}' } }] },
      { role: "tool", tool_call_id: "call_1", content: "# Title" },
    ]);
  });
});

describe("parseToolCalls", () => {
  it("reads tool calls and drops nameless entries", () => {
    expect(
      parseToolCalls([
        { id: "a", function: { name: "list_entries", arguments: "{}" } },
        { id: "b", function: { arguments: "{}" } },
      ]),
    ).toEqual([{ id: "a", name: "list_entries", arguments: "{}" }]);
  });

  it("returns an empty list for a missing field", () => {
    expect(parseToolCalls(undefined)).toEqual([]);
  });
});

describe("splitSseFrames", () => {
  it("keeps an incomplete frame as leftover", () => {
    const { payloads, rest } = splitSseFrames('data: {"a":1}\n\ndata: {"b"');
    expect(payloads).toEqual(['{"a":1}']);
    expect(rest).toBe('data: {"b"');
  });

  it("handles CRLF and ignores comment heartbeats", () => {
    const { payloads } = splitSseFrames(': ping\r\n\r\ndata: {"a":1}\r\n\r\n');
    expect(payloads).toEqual(['{"a":1}']);
  });
});

describe("streaming a text answer", () => {
  const transcript =
    'data: {"model":"gpt-x","choices":[{"delta":{"content":"Hallo "}}]}\n\n' +
    'data: {"choices":[{"delta":{"content":"Welt"}}]}\n\n' +
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
    'data: {"usage":{"prompt_tokens":11,"completion_tokens":3,"total_tokens":14}}\n\n' +
    "data: [DONE]\n\n";

  it("assembles text across arbitrary network chunk boundaries", () => {
    const { state, events } = replay(transcript, 5);
    expect(state.text).toBe("Hallo Welt");
    expect(state.finishReason).toBe("stop");
    expect(state.usage).toEqual({ promptTokens: 11, completionTokens: 3, totalTokens: 14, cost: undefined });
    expect(events.filter((e) => e.type === "text")).toHaveLength(2);
  });

  it("produces the same result regardless of chunk size", () => {
    expect(replay(transcript, 1).state.text).toBe(replay(transcript, 500).state.text);
  });
});

describe("streaming tool calls", () => {
  // Arguments arrive as fragments; only the first chunk carries id and name.
  const transcript =
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_entry","arguments":""}}]}}]}\n\n' +
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"id\\":"}}]}}]}\n\n' +
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"7\\"}"}}]}}]}\n\n' +
    'data: {"choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_2","function":{"name":"list_entries","arguments":"{}"}}]}}]}\n\n' +
    'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n' +
    "data: [DONE]\n\n";

  it("concatenates argument fragments per index", () => {
    const { state } = replay(transcript);
    const res = finishStreamState(state, "gpt-x");
    expect(res.finishReason).toBe("tool_calls");
    expect(res.toolCalls).toEqual([
      { id: "call_1", name: "get_entry", arguments: '{"id":"7"}' },
      { id: "call_2", name: "list_entries", arguments: "{}" },
    ]);
    expect(JSON.parse(res.toolCalls[0].arguments)).toEqual({ id: "7" });
  });

  it("falls back to the requested model when the stream names none", () => {
    expect(finishStreamState(replay(transcript).state, "gpt-x").model).toBe("gpt-x");
  });
});

describe("finishStreamState", () => {
  it("drops holes and unnamed calls and fills missing ids", () => {
    const state = createStreamState();
    state.toolCalls[2] = { id: "", name: "search_entries", arguments: "{}" };
    state.toolCalls[3] = { id: "x", name: "", arguments: "{}" };
    expect(finishStreamState(state, "m").toolCalls).toEqual([{ id: "call_0", name: "search_entries", arguments: "{}" }]);
  });
});

describe("reasoning deltas", () => {
  it("collects reasoning separately from the answer", () => {
    const { state } = replay(
      'data: {"choices":[{"delta":{"reasoning":"denke …"}}]}\n\ndata: {"choices":[{"delta":{"content":"Antwort"}}]}\n\ndata: [DONE]\n\n',
    );
    expect(state.reasoning).toBe("denke …");
    expect(state.text).toBe("Antwort");
  });
});
