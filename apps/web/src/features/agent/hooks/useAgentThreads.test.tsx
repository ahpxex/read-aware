import { expect, spyOn, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { getDefaultStore } from "jotai";
import { AppError, type ThreadSummary } from "@read-aware/core";
import { ToastProvider } from "@read-aware/ui";
import { userDomain } from "../../../domain";
import { activeGlobalThreadAtom } from "../../ai";
import { useAgentThreads } from "./useAgentThreads";

type State = ReturnType<typeof useAgentThreads>;
type Invalidate = Parameters<typeof userDomain.conversations.events.observeInvalidation>[0];

const thread = (id: string): ThreadSummary => ({ id, title: id, updatedAt: "2026-11-16T09:00:00.000Z" });
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

/** Mount the hook in a jsdom root with the domain's list, change feed and clear stubbed. */
async function withHook(
  reads: Array<() => Promise<ThreadSummary[]>>,
  run: (ctx: { state: () => State; invalidate: () => Promise<void>; clear: ReturnType<typeof spyOn> }) => Promise<void>,
) {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
  const values = {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  };
  const globals = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const conversations = userDomain.conversations;
  let call = 0;
  const list = spyOn(conversations.queries, "listThreads").mockImplementation(() => reads[call++]!());
  let handler: Invalidate | null = null;
  const observe = spyOn(conversations.events, "observeInvalidation").mockImplementation((next) => {
    handler = next;
    return () => {
      handler = null;
    };
  });
  const clear = spyOn(conversations.commands, "clear").mockResolvedValue(undefined as never);
  const root = createRoot(dom.window.document.getElementById("root")!);
  let state!: State;
  function Harness() {
    state = useAgentThreads();
    return null;
  }
  try {
    await act(async () => {
      root.render(
        <ToastProvider>
          <Harness />
        </ToastProvider>,
      );
    });
    await run({
      state: () => state,
      invalidate: async () => {
        await act(async () => {
          await handler!({ revision: 1, source: "local" } as never);
        });
      },
      clear,
    });
  } finally {
    await act(async () => root.unmount());
    list.mockRestore();
    observe.mockRestore();
    clear.mockRestore();
    dom.window.close();
    for (const [key, value] of globals) {
      if (value) Object.defineProperty(globalThis, key, value);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

test("a conversation change re-reads the list; a failed read is a failure, and retry recovers", async () => {
  const failure = new AppError("storage/unavailable", "fixture");
  await withHook(
    [
      async () => [thread("a")],
      async () => [thread("b"), thread("a")],
      async () => Promise.reject(failure),
      async () => [thread("b")],
    ],
    async ({ state, invalidate }) => {
      await settle();
      expect(state().threads.map((t) => t.id)).toEqual(["a"]);
      expect(state().isLoading).toBe(false);

      await invalidate();
      expect(state().threads.map((t) => t.id)).toEqual(["b", "a"]);

      await invalidate();
      expect(state().loadFailure).not.toBeNull();

      await act(async () => state().retry());
      await settle();
      expect(state().loadFailure).toBeNull();
      expect(state().threads.map((t) => t.id)).toEqual(["b"]);
    },
  );
});

test("a slow first read never overwrites a newer one", async () => {
  let releaseFirst!: (threads: ThreadSummary[]) => void;
  await withHook(
    [
      () =>
        new Promise((resolve) => {
          releaseFirst = resolve;
        }),
      async () => [thread("new")],
    ],
    async ({ state, invalidate }) => {
      await invalidate();
      expect(state().threads.map((t) => t.id)).toEqual(["new"]);
      await act(async () => releaseFirst([thread("stale")]));
      await settle();
      expect(state().threads.map((t) => t.id)).toEqual(["new"]);
    },
  );
});

test("deleting the open thread opens the next one, or a fresh one when it was the last", async () => {
  const store = getDefaultStore();
  await withHook([async () => [thread("thread-a"), thread("thread-b")]], async ({ state, clear }) => {
    await settle();
    await act(async () => state().select("thread-a"));
    await settle();
    expect(store.get(activeGlobalThreadAtom)).toBe("thread-a");

    await act(async () => state().remove("thread-a"));
    await settle();
    expect(clear).toHaveBeenCalledWith({ kind: "global", id: "thread-a" });
    expect(state().threads.map((t) => t.id)).toEqual(["thread-b"]);
    expect(store.get(activeGlobalThreadAtom)).toBe("thread-b");

    await act(async () => state().remove("thread-b"));
    await settle();
    expect(state().threads).toEqual([]);
    expect(store.get(activeGlobalThreadAtom)).toMatch(/^thread-/);
    expect(store.get(activeGlobalThreadAtom)).not.toBe("thread-b");
  });
});
