import { expect, test } from "bun:test";
import { AppError, type Id, type ReadingNavigationReceipt } from "@read-aware/core";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildReaderTools } from "./reader-tools";

const bookId = "book" as Id;
const receipt: ReadingNavigationReceipt = {
  status: "completed", sessionId: "session",
  location: { bookId, contentVersion: "sha256:fixture", cfi: "actual" },
};
function fixture() {
  const { deps, stores } = createInMemoryDeps({ books: [{ id: bookId, title: "Reading test", progressPercent: 0, status: "reading" }] });
  const tools = buildReaderTools({ kind: "book", bookId }, deps);
  const tool = (name: string) => tools.find(tool => tool.name === name)!;
  return { deps, stores, tool };
}

test("open_book only reports opened after the renderer completes, preserving its actual location", async () => {
  const { deps, tool } = fixture();
  let finish!: (receipt: ReadingNavigationReceipt) => void;
  deps.reader.openBook = () => new Promise(resolve => { finish = resolve; });
  let completed = false;
  const pending = tool("open_book").execute("test", {}).then(result => { completed = true; return result; });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(completed).toBe(false);
  finish(receipt);
  const result = await pending;
  expect(result.content[0]).toMatchObject({ type: "text" });
  if (result.content[0]?.type !== "text") throw new Error("Expected text");
  expect(JSON.parse(result.content[0].text)).toMatchObject({ opened: true, ...receipt });
});

test("open_book propagates a failed host navigation without a success acknowledgement", async () => {
  const { deps, tool } = fixture();
  deps.reader.goTo = async () => { throw new AppError("reader/target-not-found", "Missing"); };
  await expect(tool("open_book").execute("test", { anchor: "missing" })).rejects.toMatchObject({ code: "reader/target-not-found" });
});

test("versioned fraction targets and cancellation reach the reader port unchanged", async () => {
  const { deps, tool } = fixture(); const abort = new AbortController();
  let passedSignal: AbortSignal | undefined;
  let passedTarget: unknown;
  deps.reader.goTo = async (target, signal) => { passedTarget = target; passedSignal = signal; return receipt; };
  await tool("open_book").execute("test", { fraction: 0.4, contentVersion: "sha256:fixture" }, abort.signal);
  expect(passedSignal).toBe(abort.signal);
  expect(passedTarget).toMatchObject({ bookId, fraction: 0.4, contentVersion: "sha256:fixture" });
});

test("book-scoped controls pass both session and book guards to the host", async () => {
  const { deps, tool } = fixture(); const abort = new AbortController();
  const snapshot = await deps.reader.getSession();
  let passedGuard: unknown; let passedSignal: AbortSignal | undefined;
  deps.reader.back = async (signal, guard) => { passedGuard = guard; passedSignal = signal; return receipt; };
  await tool("navigate_reading").execute("test", { action: "back" }, abort.signal);
  expect(passedGuard).toEqual({ sessionId: snapshot.sessionId, bookId });
  expect(passedSignal).toBe(abort.signal);
});

test("another book's viewport is neither exposed nor controlled by a book-scoped turn", async () => {
  const { deps, stores, tool } = fixture();
  await deps.reader.openBook("other" as Id);
  const count = stores.readerRequests.length;
  const result = await tool("get_reading_session").execute("test", {});
  if (result.content[0]?.type !== "text") throw new Error("Expected text");
  expect(JSON.parse(result.content[0].text)).toEqual({ status: "not-active", bookId });
  await expect(tool("navigate_reading").execute("test", { action: "next" })).rejects.toThrow("not the active reader");
  expect(stores.readerRequests).toHaveLength(count);
});

test("an annotation without a location does not silently succeed as an open-book action", async () => {
  const { deps, stores, tool } = fixture();
  deps.annotations.listAnnotations = async () => [{ kind: "note", id: "note" as Id, bookId, body: "Unanchored", createdAt: "2026-09-08T00:00:00Z", updatedAt: "2026-09-08T00:00:00Z" }];
  await expect(tool("open_book").execute("test", { annotationId: "note" })).rejects.toThrow("no navigable location");
  expect(stores.readerRequests).toHaveLength(0);
});
