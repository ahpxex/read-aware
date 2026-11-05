import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { windowByTurns } from "./windowing";

function user(text: string): AgentMessage {
  return { role: "user", content: text, timestamp: 0 };
}

function assistant(text: string): AgentMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "faux",
    provider: "faux",
    model: "faux",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 0,
  };
}

describe("windowByTurns", () => {
  const transcript = [user("q1"), assistant("a1"), user("q2"), assistant("a2"), user("q3")];

  test("keeps everything when the window is large enough", () => {
    expect(windowByTurns(transcript, 12)).toEqual(transcript);
  });

  test("cuts at a user-message boundary", () => {
    expect(windowByTurns(transcript, 2)).toEqual([user("q2"), assistant("a2"), user("q3")]);
  });

  test("window of one keeps only the current turn", () => {
    expect(windowByTurns(transcript, 1)).toEqual([user("q3")]);
  });

  test("zero window yields nothing", () => {
    expect(windowByTurns(transcript, 0)).toEqual([]);
  });

  test("system messages cut from the window fold into the leading message; later ones stay in place", () => {
    const tool = (name: string) => ({ name, description: name, parameters: { type: "object", properties: {} } });
    const withSystem: AgentMessage[] = [
      { role: "system", content: "prompt", toolsAdded: [tool("a")], timestamp: 0 },
      user("q1"),
      assistant("a1"),
      { role: "system", content: "", toolsAdded: [tool("b")], timestamp: 0 },
      user("q2"),
      assistant("a2"),
      { role: "system", content: "", toolsRemoved: [{ name: "a" }], timestamp: 0 },
      user("q3"),
    ];
    expect(windowByTurns(withSystem, 2)).toEqual([
      { role: "system", content: "prompt", toolsAdded: [tool("a"), tool("b")], timestamp: 0 },
      user("q2"),
      assistant("a2"),
      withSystem[6]!,
      user("q3"),
    ]);
    expect(windowByTurns(withSystem, 1)).toEqual([
      { role: "system", content: "prompt", toolsAdded: [tool("b")], timestamp: 0 },
      user("q3"),
    ]);
    expect(windowByTurns(withSystem, 0)).toEqual([
      { role: "system", content: "prompt", toolsAdded: [tool("b")], timestamp: 0 },
    ]);
    expect(windowByTurns(withSystem, 3)).toEqual(withSystem);
  });
});
