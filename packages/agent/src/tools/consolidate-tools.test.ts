import { expect, test } from "bun:test";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { consolidateHostTools } from "./consolidate-tools";
import { setToolAvailability } from "./tool-availability";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildAgentTools } from "./registry";
import { obj, str } from "@earendil-works/pi-schema";

const parsed = (result: any) => JSON.parse(result.content[0].text);

test("group schemas reject wrong operations, missing fields, and foreign branch arguments before side effects", async () => {
  let calls = 0;
  const operation: AgentTool = {
    name: "pause_book_text_task",
    label: "Pause",
    description: "Pause this request",
    parameters: obj({ taskId: str({ minLength: 1 }) }),
    execute: async () => {
      calls++;
      return { content: [{ type: "text", text: "ok" }], details: {} };
    },
  };
  const tool = consolidateHostTools([operation]).enabled[0]!;
  expect(tool.name).toBe("manage_book_text_task");
  expect(tool.executionMode).toBe("sequential");
  for (const request of [
    { operation: "cancel", taskId: "t" },
    { operation: "pause" },
    { operation: "pause", taskId: "" },
    { operation: "pause", taskId: "t", bookId: "b" },
  ])
    await expect(tool.execute("x", { request })).rejects.toThrow();
  expect(calls).toBe(0);
  await tool.execute("x", { request: { operation: "pause", taskId: "t" } });
  expect(calls).toBe(1);
  const abort = new AbortController();
  abort.abort();
  await expect(tool.execute("x", { request: { operation: "pause", taskId: "t" } }, abort.signal)).rejects.toThrow();
  expect(calls).toBe(1);
});

test("unavailable operations disappear from the schema while the enabled handler retains signal and progress", async () => {
  const abort = new AbortController();
  let received: unknown;
  const update = () => {};
  const first: AgentTool = {
    name: "get_reader_panels",
    label: "Panels",
    description: "Inspect",
    parameters: obj({}),
    execute: async (...args) => {
      received = args;
      return { content: [], details: {} };
    },
  };
  const disabled = { ...first, name: "set_reader_panel" };
  setToolAvailability(disabled, { state: "unavailable", reason: "Reader closed" });
  const group = consolidateHostTools([first, disabled]).enabled[0]!;
  expect(JSON.stringify(group.parameters)).not.toContain('"const":"set"');
  await expect(group.execute("x", { request: { operation: "set" } })).rejects.toThrow();
  await group.execute("x", { request: { operation: "inspect" } }, abort.signal, update);
  expect(received).toEqual(["x", {}, abort.signal, update]);
});

test("grouped operations still recheck active reader permissions after discovery", async () => {
  const { deps } = createInMemoryDeps();
  let ready = true;
  deps.reader.toolContext = () => ({
    bookId: "b",
    session: ready,
    ready,
    selection: true,
    controls: true,
    panels: true,
    modes: true,
    playback: true,
    imageBookId: "b",
  });
  const tool = buildAgentTools({ kind: "book", bookId: "b" }, deps).find((t) => t.name === "reader_panels")!;
  ready = false;
  await expect(tool.execute("x", { request: { operation: "set", panel: "toc", open: true } })).rejects.toMatchObject({
    code: "ui/unavailable",
  });
});

test("navigation TOC preserves source locations without preparing or reading indexed text", async () => {
  const { deps } = createInMemoryDeps({
    books: [{ id: "b", title: "Book" }],
    chapters: { b: [{ title: "第十章", text: "source" }] },
  });
  deps.bookText.getToc = async () => {
    throw new Error("Must not read indexed text");
  };
  const tool = buildAgentTools({ kind: "book", bookId: "b" }, deps).find((t) => t.name === "get_toc")!;
  const result = parsed(await tool.execute("x", { view: "navigation" }));
  expect(result.entries[0]).toMatchObject({ label: "第十章", ordinal: 1, location: { bookId: "b" } });
  expect(result.coordinatePolicy).toContain("not indexed chapter coordinates");
  await expect(tool.execute("x", { view: "invented" })).rejects.toThrow();
});
