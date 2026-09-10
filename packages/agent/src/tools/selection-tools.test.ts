import { expect, test } from "bun:test";
import { AppError, type Id } from "@read-aware/core";
import { createInMemoryDeps } from "../testing/fixtures";
import { contextPolicyState } from "../testing/reading-context-policy";
import { buildReaderTools } from "./reader-tools";
import { createAgentTurnState } from "./turn-state";

const range = { bookId: "book", contentVersion: "fixture", cfi: "epubcfi(/6/2!/4/2,/1:0,/1:6)", textQuote: { exact: "needle", prefix: "private" } };
function fixture() {
  const { deps } = createInMemoryDeps();
  return { deps, tool: () => buildReaderTools({ kind: "book", bookId: "book" as Id }, deps).find(t => t.name === "set_reading_selection")! };
}
test("selection tool forwards the copied range, cancellation and observed session guard, awaiting actual completion", async () => {
  const { deps, tool } = fixture(); await deps.reader.openBook("book");
  let release!: () => void, observed: unknown;
  const abort = new AbortController();
  deps.reader.selectRange = async (...args) => {
    observed = args; await new Promise<void>(resolve => { release = resolve; });
    return { status: "completed", sessionId: "fixture", selection: { id: "selected", text: "secret", textLength: 6, range } };
  };
  let done = false;
  const pending = tool().execute("select", { action: "select", range }, abort.signal).then(value => { done = true; return value; });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(done).toBe(false); expect(observed).toEqual([range, abort.signal, { bookId: "book", sessionId: "fixture" }]);
  release(); const result = await pending;
  expect(result.content[0]).toEqual({ type: "text", text: JSON.stringify({ status: "completed", sessionId: "fixture", selectionId: "selected" }) });
});

test("selection receipts never disclose text or quote context under privacy or a spoiler fence", async () => {
  const { deps } = fixture(); await deps.reader.openBook("book");
  deps.readingContextPolicy = contextPolicyState({ selection: false, surrounding: false });
  const state = createAgentTurnState(); state.spoilerFence = { throughChapterIndex: 0 };
  const tools = buildReaderTools({ kind: "book", bookId: "book" as Id }, deps, state);
  const result = await tools.find(t => t.name === "set_reading_selection")!.execute("select", { action: "select", range });
  expect(JSON.stringify(result)).not.toContain("needle"); expect(JSON.stringify(result)).not.toContain("private");
  const session = await tools.find(t => t.name === "get_reading_session")!.execute("read", {});
  expect(JSON.stringify(session)).not.toContain("needle");
  const id = (await deps.reader.getSession()).selection!.id;
  await tools.find(t => t.name === "set_reading_selection")!.execute("clear", { action: "clear", selectionId: id });
  expect((await deps.reader.getSession()).selection).toBeNull();
});

test("invalid action combinations and foreign books cannot dispatch; stale clear never chooses a fresh ID", async () => {
  const { deps, tool } = fixture(); await deps.reader.openBook("book");
  for (const input of [ { action: "clear" }, { action: "clear", selectionId: "x", range },
    { action: "select", range, selectionId: "x" }, { action: "toggle" }, { action: "select", range, arbitrary: true } ]) {
    await expect(tool().execute("invalid", input)).rejects.toMatchObject({ code: "reader/invalid-target" });
  }
  await expect(tool().execute("other", { action: "select", range: { ...range, bookId: "other" } })).rejects.toMatchObject({ code: "reader/out-of-scope" });
  await tool().execute("select", { action: "select", range });
  const first = (await deps.reader.getSession()).selection!.id;
  await tool().execute("select", { action: "select", range });
  await expect(tool().execute("clear", { action: "clear", selectionId: first })).rejects.toMatchObject({ code: "reader/superseded" });
  expect((await deps.reader.getSession()).selection).not.toBeNull();
  await deps.reader.openBook("other");
  await expect(tool().execute("other", { action: "clear", selectionId: first })).rejects.toMatchObject({ code: "reader/out-of-scope" });
});

test("host failure and pre-abort remain failures, never successful selection receipts", async () => {
  const { deps, tool } = fixture(); await deps.reader.openBook("book");
  deps.reader.selectRange = async () => { throw new AppError("reader/target-not-found", "Missing target"); };
  await expect(tool().execute("select", { action: "select", range })).rejects.toMatchObject({ code: "reader/target-not-found" });
  const abort = new AbortController(); abort.abort(Error("stopped"));
  await expect(tool().execute("select", { action: "select", range }, abort.signal)).rejects.toThrow("stopped");
});

test("both privacy and spoiler withholding remove nested position quotes without mutating host state", async () => {
  for (const restriction of ["privacy", "spoiler"] as const) {
    const { deps } = fixture(); await deps.reader.openBook("book");
    const original = await deps.reader.getSession();
    original.location = range;
    original.mode.position = { location: range, modeKey: "fixture", unitId: "sentence" };
    deps.reader.getSession = async () => original;
    deps.readingContextPolicy = contextPolicyState({ selection: restriction !== "privacy", surrounding: true });
    const state = createAgentTurnState();
    if (restriction === "spoiler") state.spoilerFence = { throughChapterIndex: 0 };
    const result = await buildReaderTools({ kind: "book", bookId: "book" as Id }, deps, state).find(t => t.name === "get_reading_session")!.execute("session", {});
    expect(JSON.stringify(result)).not.toContain("needle");
    expect(JSON.stringify(result)).not.toContain("private");
    expect(original.location.textQuote).toEqual(range.textQuote);
    expect(original.mode.position.location.textQuote).toEqual(range.textQuote);
  }
});
