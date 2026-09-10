import { expect, spyOn, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AppError } from "@read-aware/core";
import * as domain from "../../../domain/annotations";
import { AnnotationObserver } from "../../../domain/annotation-observer";
import * as mutations from "../lib/native-annotation-mutations";
import type { Annotation, Note } from "../lib/annotation-types";
import { useAnnotations } from "./useAnnotations";

test("all/book collections observe failures and recovery, release scopes, and delete the displayed revision without late UI mutation", async () => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
  const values = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const globals = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const root = createRoot(dom.window.document.getElementById("root")!);
  const scheduled = new Set<() => void>(), reports: unknown[] = [], signals: AbortSignal[] = [];
  const observer = new AnnotationObserver({
    schedule(work) { scheduled.add(work); return () => { scheduled.delete(work); }; },
    report(error) { reports.push(error); },
  });
  const note: Note = { id: "note", bookId: "one", type: "note", text: "quote", content: "original",
    cfiRange: null, chapterHref: null, createdAt: "then", updatedAt: "then", revision: `ann1:${"a".repeat(64)}` };
  let read = async (): Promise<Annotation[]> => [note];
  const all = spyOn(domain, "observeAllAnnotations").mockImplementation((handler, signal) => {
    signals.push(signal!); return observer.observeSnapshot(() => read(), handler, signal);
  });
  const book = spyOn(domain, "observeBookAnnotations").mockImplementation((id, handler, signal) => {
    signals.push(signal!); return observer.observeSnapshot(async () => (await read()).filter(row => row.bookId === id), handler, signal);
  });
  const conflict = new AppError("annotations/conflict", "Changed by another actor");
  const write = spyOn(mutations, "changeObservedAnnotation").mockRejectedValue(conflict);
  let state!: ReturnType<typeof useAnnotations>;
  function Harness({ scope }: { scope: Parameters<typeof useAnnotations>[0] }) { state = useAnnotations(scope); return null; }
  async function poll() {
    await act(async () => { const work = [...scheduled]; scheduled.clear(); for (const run of work) run(); });
  }
  try {
    await act(async () => { root.render(<Harness scope={null} />); });
    expect(all).not.toHaveBeenCalled(); expect(state.annotations).toEqual([]);
    await act(async () => { root.render(<Harness scope={{ kind: "all" }} />); });
    expect(state.annotations).toEqual([note]); expect(state.isLoading).toBe(false);
    // A new stored version must not turn the preceding displayed decision into an unconditional write.
    read = async () => [{ ...note, content: "newer", revision: `ann1:${"b".repeat(64)}` }];
    await expect(state.remove(note.id)).rejects.toBe(conflict);
    expect(write.mock.calls[0]).toEqual([note, { op: "remove" }]);
    expect(state.annotations[0]).toEqual(note);
    await poll(); expect(state.annotations[0]).toMatchObject({ content: "newer" });

    read = async () => { throw new AppError("db/locked", "fixture"); };
    await poll(); expect(state).toMatchObject({ annotations: [], isLoading: false, loadFailed: true, loadErrorCode: "db/locked" });
    expect(reports).toHaveLength(1);
    read = async () => [note]; await poll();
    expect(state).toMatchObject({ annotations: [note], loadFailed: false, loadErrorCode: undefined });

    let finishWrite!: () => void, pending!: Promise<void>;
    write.mockImplementation(() => new Promise<void>(resolve => { finishWrite = resolve; }));
    await act(async () => { pending = state.remove(note.id); });
    await act(async () => { root.render(<Harness scope={null} />); });
    expect(signals[0].aborted).toBe(true); expect(scheduled.size).toBe(0);
    await act(async () => { root.render(<Harness scope={{ kind: "book", bookId: "one" }} />); });
    expect(book).toHaveBeenCalledWith("one", expect.any(Function), expect.any(AbortSignal));
    await act(async () => { finishWrite(); await pending; });
    expect(state.annotations).toEqual([note]);

    let finishRead!: (rows: Annotation[]) => void;
    read = () => new Promise(resolve => { finishRead = resolve; });
    await poll();
    const oldRead = finishRead;
    await act(async () => { root.render(<Harness scope={{ kind: "book", bookId: "two" }} />); });
    const newRead = finishRead;
    expect(signals[1].aborted).toBe(true); expect(state.isLoading).toBe(true); expect(state.annotations).toEqual([]);
    await act(async () => { newRead([{ ...note, id: "second", bookId: "two" }]); });
    await act(async () => { oldRead([note]); });
    expect(state.annotations.map(row => row.id)).toEqual(["second"]);
    await act(async () => { state.refresh(); });
    expect(signals[2].aborted).toBe(true); expect(state.isLoading).toBe(true);
    await act(async () => { root.render(<Harness scope={null} />); finishRead([note]); });
    expect(state.annotations).toEqual([]); expect(state.isLoading).toBe(false); expect(scheduled.size).toBe(0);
  } finally {
    await act(async () => { root.unmount(); });
    all.mockRestore(); book.mockRestore(); write.mockRestore(); dom.window.close();
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
