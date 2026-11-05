import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Tool } from "@earendil-works/pi-ai";
import { hasConversation, modelRequestView, withConversation, withSystemPrompt } from "./transcript";

const tool = (name: string): Tool => ({ name, description: name, parameters: { type: "object", properties: {} } });
const user = (text: string): AgentMessage => ({ role: "user", content: text, timestamp: 1 });

describe("transcript system state", () => {
  test("a refreshed prompt replaces the leading message and keeps its tool declarations", () => {
    const messages: AgentMessage[] = [
      { role: "system", content: "old prompt", toolsAdded: [tool("a")], timestamp: 0 },
      user("q1"),
      { role: "system", content: "", toolsAdded: [tool("b")], timestamp: 2 },
    ];
    const next = withSystemPrompt(messages, "new prompt");
    expect(next[0]).toEqual({ role: "system", content: "new prompt", toolsAdded: [tool("a")], timestamp: 0 });
    expect(next.slice(1)).toEqual(messages.slice(1));
    expect(modelRequestView({ messages: next }).systemPrompt).toBe("new prompt");
  });

  test("a prompt is inserted ahead of a transcript without one", () => {
    const next = withSystemPrompt([user("q1")], "prompt");
    expect(next[0]).toMatchObject({ role: "system", content: "prompt" });
    expect(next[1]).toEqual(user("q1"));
  });

  test("replacing the conversation folds the prompt and tool state into one leading message", () => {
    const messages: AgentMessage[] = [
      { role: "system", content: "prompt", toolsAdded: [tool("a"), tool("b")], timestamp: 0 },
      user("q1"),
      { role: "system", content: "", toolsAdded: [tool("c")], toolsRemoved: [{ name: "a" }], timestamp: 2 },
    ];
    const next = withConversation(messages, [user("q2")]);
    expect(next).toEqual([
      { role: "system", content: "prompt", toolsAdded: [tool("b"), tool("c")], timestamp: 0 },
      user("q2"),
    ]);
    expect(hasConversation(next)).toBe(true);
    expect(hasConversation(next.slice(0, 1))).toBe(false);
  });

  test("the request view reads a raw context and a transcript context alike", () => {
    const raw = modelRequestView({ systemPrompt: "prompt", tools: [tool("a")], messages: [user("q")] });
    const transcript = modelRequestView({
      messages: [{ role: "system", content: "prompt", toolsAdded: [tool("a")], timestamp: 0 }, user("q")],
    });
    expect(transcript).toEqual(raw);
    expect(raw).toEqual({ systemPrompt: "prompt", tools: [tool("a")], messages: [user("q")] });
  });
});
