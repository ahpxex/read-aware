import { describe, expect, test } from "bun:test";
import { appendStreamChunk, finalizeParts, partsText } from "./chat-stream";
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
