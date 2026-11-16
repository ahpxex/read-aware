import { afterEach, expect, spyOn, test } from "bun:test";
import { JSDOM } from "jsdom";
import * as agentRuntime from "./agent-runtime";
import * as libraryDb from "../../library/lib/library-db";
import { memoryPolicy } from "./memory-policy";
import { startAgentMaintenance } from "./maintenance";

const restore: Array<() => void> = [];
afterEach(() => {
  for (const undo of restore.splice(0)) undo();
});

/** A document in the given visibility, whose idle callbacks run at once. */
function withDocument(visibility: "visible" | "hidden") {
  const dom = new JSDOM("<div></div>", { url: "http://localhost" });
  Object.defineProperty(dom.window.document, "visibilityState", { configurable: true, get: () => visibility });
  (dom.window as unknown as { requestIdleCallback: (work: () => void) => number }).requestIdleCallback = (work) => {
    queueMicrotask(work);
    return 1;
  };
  const values = { window: dom.window, document: dom.window.document };
  for (const [key, value] of Object.entries(values)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    restore.push(() => {
      if (previous) Object.defineProperty(globalThis, key, previous);
      else Reflect.deleteProperty(globalThis, key);
    });
  }
  restore.push(() => dom.window.close());
}

/** A runtime recording which upkeep it was asked for. */
function fakeRuntime() {
  const calls: string[] = [];
  const runtime = {
    titleThreads: async (query: { limit: number }) => {
      calls.push(`titles:${query.limit}`);
      return { titled: 0, halted: false };
    },
    consolidateIfNeeded: async () => {
      calls.push("consolidate");
      return null;
    },
    digestBook: async () => {
      calls.push("digest");
      return { status: "complete" };
    },
  };
  const spy = spyOn(agentRuntime, "getAgentRuntime").mockReturnValue(runtime as never);
  const books = spyOn(libraryDb, "listLibraryBooks").mockResolvedValue([]);
  restore.push(
    () => spy.mockRestore(),
    () => books.mockRestore(),
  );
  return calls;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test("an idle tick titles threads even with memory building off, and builds no memory then", async () => {
  withDocument("visible");
  const calls = fakeRuntime();
  const policy = spyOn(memoryPolicy, "enabled").mockReturnValue(false);
  restore.push(() => policy.mockRestore());
  const stop = startAgentMaintenance();
  await settle();
  stop();
  expect(calls).toEqual(["titles:4"]);
});

test("with memory building on, titles come first and memory upkeep follows", async () => {
  withDocument("visible");
  const calls = fakeRuntime();
  const policy = spyOn(memoryPolicy, "enabled").mockReturnValue(true);
  restore.push(() => policy.mockRestore());
  const stop = startAgentMaintenance();
  await settle();
  stop();
  expect(calls).toEqual(["titles:4", "consolidate"]);
});

test("a hidden window does no upkeep at all", async () => {
  withDocument("hidden");
  const calls = fakeRuntime();
  const stop = startAgentMaintenance();
  await settle();
  stop();
  expect(calls).toEqual([]);
});
