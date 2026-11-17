import { expect, test } from "bun:test";
import { groupChatActivity } from "./chat-activity";
import type { ChatAssistantPart, ChatToolPart } from "./chat-types";

const search: ChatToolPart = { type: "tool", id: "search", tool: "web_search", state: "done" };
const fetch: ChatToolPart = { type: "tool", id: "fetch", tool: "web_fetch", state: "running" };

test("one activity group across prose and images preserves visible content order and the source timeline", () => {
  const intro: ChatAssistantPart = { type: "text", text: "Let me look that up." };
  const reasoning: ChatAssistantPart = { type: "thinking", text: "Find the original source." };
  const image: ChatAssistantPart = { type: "reference", id: "images", reference: { kind: "web-images", images: [] } };
  const reply: ChatAssistantPart = { type: "text", text: "Here is the result." };
  const parts = [intro, search, image, reasoning, fetch, reply];
  const before = structuredClone(parts);

  expect(groupChatActivity(parts)).toEqual([
    intro,
    { type: "activity", parts: [search, reasoning, fetch], precedesProse: true },
    image,
    reply,
  ]);
  expect(parts).toEqual(before);
});

test("a pending interaction stays visible while its calling tool is grouped", () => {
  const prompt: ChatAssistantPart = {
    type: "interaction",
    id: "confirm",
    state: "pending",
    request: { id: "confirm", threadKey: "global:test", kind: "permission", action: "delete-book", subject: "Example" },
  };
  const running: ChatToolPart = { type: "tool", id: "delete", tool: "delete_book", state: "running" };
  expect(groupChatActivity([search, running, prompt])).toEqual([
    { type: "activity", parts: [search, running], precedesProse: false },
    prompt,
  ]);
});

test("turns without tools retain their standalone reasoning and legacy text presentation", () => {
  const parts: ChatAssistantPart[] = [
    { type: "thinking", text: "Check the passage." },
    { type: "text", text: "The answer." },
  ];
  expect(groupChatActivity(parts)).toBe(parts);
  expect(groupChatActivity([])).toEqual([]);
});

test("only prose after the group marks it as preceding the answer", () => {
  const intro: ChatAssistantPart = { type: "text", text: "Let me look that up." };
  const blank: ChatAssistantPart = { type: "text", text: "  " };
  expect(groupChatActivity([intro, search, blank, fetch])).toEqual([
    intro,
    { type: "activity", parts: [search, fetch], precedesProse: false },
    blank,
  ]);
});
