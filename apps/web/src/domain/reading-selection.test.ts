import { expect, test } from "bun:test";
import { AppError, type ReadingSelectionSnapshot } from "@read-aware/core";
import { ReadingSessionController, type ReadingSelectionAdapter } from "./reading-session-controller";

const range = { bookId: "book", contentVersion: "v1", cfi: "epubcfi(/6/2!/4/2,/1:0,/1:6)" };
const selected = (id: string): ReadingSelectionSnapshot => ({ id, text: "needle", textLength: 6, range });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture() {
  const runtime = new ReadingSessionController(() => {}, 1000), id = runtime.begin("book"), moves: unknown[] = [];
  runtime.attach(id, { navigate: async target => { moves.push(target); return range; }, step: async () => range }, { ...range, cfi: "start" });
  let retired = false;
  const adapter: ReadingSelectionAdapter = {
    validate: async () => {},
    select: async () => { const result = selected("applied"); runtime.selectionChanged(id, result); return result; },
    clear: async () => { runtime.selectionChanged(id, null); },
    retire: () => { retired = true; },
  };
  const off = runtime.bindSelection(id, adapter);
  return { runtime, id, adapter, off, moves, retired: () => retired };
}

test("selection validates before movement and completion joins overlay acknowledgement", async () => {
  const f = fixture(); let validate!: () => void, paint!: () => void;
  f.adapter.validate = () => new Promise(resolve => { validate = resolve; });
  f.adapter.select = async () => {
    const result = selected("applied"); f.runtime.selectionChanged(f.id, result);
    await new Promise<void>(resolve => { paint = resolve; }); return result;
  };
  let done = false;
  const pending = f.runtime.selectRange(range).then(value => { done = true; return value; });
  await tick(); expect(f.moves).toEqual([]); validate(); await tick();
  expect(f.moves).toHaveLength(1); expect(done).toBe(false);
  expect(f.runtime.snapshot().history.canGoBack).toBe(false);
  paint(); const receipt = await pending;
  expect(receipt).toMatchObject({ status: "completed", sessionId: f.id, selection: selected("applied") });
  receipt.selection!.text = "changed"; expect(f.runtime.snapshot().selection?.text).toBe("needle");
  expect(f.runtime.snapshot().history.canGoBack).toBe(true);
  f.off();
});

test("invalid, stale, foreign and source-rejected ranges never move the engine", async () => {
  const f = fixture();
  await expect(f.runtime.selectRange({ ...range, contentVersion: "old" })).rejects.toMatchObject({ code: "reader/stale-location" });
  await expect(f.runtime.selectRange({ ...range, bookId: "other" })).rejects.toMatchObject({ code: "reader/out-of-scope" });
  await expect(f.runtime.selectRange({ ...range, cfi: "invented" })).rejects.toMatchObject({ code: "library/invalid-range" });
  await expect(f.runtime.selectRange(range, undefined, { sessionId: "old" })).rejects.toMatchObject({ code: "reader/superseded" });
  f.adapter.validate = async () => { throw new AppError("library/range-not-found", "Source no longer resolves"); };
  await expect(f.runtime.selectRange(range)).rejects.toMatchObject({ code: "library/range-not-found" });
  expect(f.moves).toEqual([]); f.off();
});

test("new selection, navigation, cancellation or retirement invalidate pending validation", async () => {
  for (const action of ["selection", "navigation", "abort", "retire", "replace"] as const) {
    const f = fixture(), abort = new AbortController(); let release!: () => void;
    f.adapter.validate = () => new Promise(resolve => { release = resolve; });
    const pending = f.runtime.selectRange(range, abort.signal).catch(error => error);
    await tick();
    if (action === "selection") f.runtime.selectionChanged(f.id, selected("user"));
    if (action === "navigation") await f.runtime.navigate({ cfi: "new" });
    if (action === "abort") abort.abort(new AppError("plugin/cancelled", "Stopped"));
    if (action === "retire") f.off();
    const replacement = action === "replace" ? f.runtime.bindSelection(f.id, { ...f.adapter }) : undefined;
    expect(await pending).toMatchObject({ code: action === "abort" ? "plugin/cancelled" : "reader/superseded" });
    release(); await tick();
    expect(f.moves).toHaveLength(action === "navigation" ? 1 : 0); replacement?.(); f.off();
  }
});

test("clear is bound to the observed identity and waits for its UI completion", async () => {
  const f = fixture(); f.runtime.selectionChanged(f.id, selected("user"));
  let calls = 0, paint!: () => void;
  f.adapter.clear = async () => { calls++; f.runtime.selectionChanged(f.id, null); await new Promise<void>(resolve => { paint = resolve; }); };
  await expect(f.runtime.clearSelection("old")).rejects.toMatchObject({ code: "reader/superseded" });
  expect(calls).toBe(0);
  const pending = f.runtime.clearSelection("user").catch(error => error); await tick();
  f.runtime.selectionChanged(f.id, selected("newer")); paint();
  expect(await pending).toMatchObject({ code: "reader/superseded" });
  expect(f.runtime.snapshot().selection?.id).toBe("newer"); f.off(); expect(f.retired()).toBe(true);
});

test("the navigation consumer accepts the full 12000-character range quote contract", async () => {
  const f = fixture();
  await f.runtime.navigate({ ...range, textQuote: { exact: "x".repeat(12000) } });
  expect(f.moves).toHaveLength(1);
  await expect(f.runtime.navigate({ ...range, textQuote: { exact: "x".repeat(12001) } })).rejects.toMatchObject({ code: "reader/invalid-target" });
  f.off();
});
