import { describe, expect, test } from "bun:test";
import { appendStreamChunk, finalizeParts, partsText, toolTraceText } from "./chat-stream";
import type { ChatAssistantPart, ChatInteractionRequest } from "./chat-types";

const question: ChatInteractionRequest = {
  id: "global:thread-1:call-1",
  threadKey: "global:thread-1",
  kind: "question",
  question: "Which direction?",
  options: [
    { id: "summary", label: "Summarize" },
    { id: "compare", label: "Compare" },
  ],
  allowCustom: true,
};

describe("chat interaction stream assembly", () => {
  test("pairs request and response into one persistent timeline part", () => {
    let parts: ChatAssistantPart[] = [];
    parts = appendStreamChunk(parts, {
      type: "interaction",
      phase: "request",
      request: question,
    });
    parts = appendStreamChunk(parts, {
      type: "interaction",
      phase: "request",
      request: question,
    });
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ type: "interaction", state: "pending" });

    parts = appendStreamChunk(parts, {
      type: "interaction",
      phase: "response",
      id: question.id,
      answer: { optionId: "compare", text: "Compare" },
    });
    expect(parts[0]).toMatchObject({
      type: "interaction",
      state: "answered",
      answer: { optionId: "compare", text: "Compare" },
    });
    expect(partsText(parts)).toBe("");
  });

  test("settles an abandoned pending prompt as cancelled", () => {
    const parts = appendStreamChunk([], {
      type: "interaction",
      phase: "request",
      request: question,
    });
    expect(finalizeParts(parts)[0]).toMatchObject({
      type: "interaction",
      state: "cancelled",
      answer: { cancelled: true },
    });
  });
});

describe("tool trace assembly", () => {
  test("persists bounded input and output on the same tool part", () => {
    let parts: ChatAssistantPart[] = [];
    parts = appendStreamChunk(parts, {
      type: "tool",
      phase: "start",
      id: "call-1",
      tool: "get_settings",
      input: '{\n  "section": "reading"\n}',
    });
    parts = appendStreamChunk(parts, {
      type: "tool",
      phase: "update",
      id: "call-1",
      output: "Reading the current override…",
    });
    expect(parts[0]).toMatchObject({ state: "running", output: "Reading the current override…" });

    parts = appendStreamChunk(parts, {
      type: "tool",
      phase: "end",
      id: "call-1",
      isError: false,
      output: '{\n  "fontSize": "large"\n}',
    });

    expect(parts).toEqual([
      {
        type: "tool",
        id: "call-1",
        tool: "get_settings",
        detail: undefined,
        input: '{\n  "section": "reading"\n}',
        output: '{\n  "fontSize": "large"\n}',
        state: "done",
      },
    ]);
    expect(finalizeParts(parts)).toEqual(parts);
  });

  test("pretty-prints JSON results and caps oversized trace content", () => {
    expect(toolTraceText('{"updated":true}')).toBe('{\n  "updated": true\n}');
    const oversized = toolTraceText("x".repeat(9_000));
    expect(oversized?.length).toBeLessThan(9_000);
    expect(oversized?.endsWith("\n…")).toBe(true);
  });
});
