import { expect, spyOn, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AppError } from "@read-aware/core";
import * as mutations from "../../annotations/lib/native-annotation-mutations";
import type { Note } from "../../annotations/lib/annotation-types";
import { useReaderNoteEditor } from "./useReaderNoteEditor";

test("native note draft pins its token, preserves conflicts, joins one save and isolates replacement drafts", async () => {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
  const values = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const globals = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const root = createRoot(dom.window.document.getElementById("root")!);
  const conflict = new AppError("annotations/conflict", "fixture");
  const write = spyOn(mutations, "changeObservedAnnotation").mockRejectedValue(conflict);
  const errors: unknown[] = [];
  let state!: ReturnType<typeof useReaderNoteEditor>, clears = 0;
  const clear = () => { clears++; }, report = (error: unknown) => { errors.push(error); };
  function Harness({ bookId = "book" }: { bookId?: string }) {
    state = useReaderNoteEditor(bookId, clear, report); return null;
  }
  const note: Note = { id: "note", bookId: "book", type: "note", text: "passage", content: "original",
    cfiRange: "cfi", chapterHref: null, createdAt: "then", updatedAt: "then", revision: `ann1:${"a".repeat(64)}` };
  const target = { text: note.text, cfiRange: note.cfiRange, chapterHref: null };
  try {
    await act(async () => { root.render(<Harness />); });
    await act(async () => { state.open(target, note); });
    const originalRevision = note.revision;
    Object.assign(note, { revision: `ann1:${"b".repeat(64)}`, content: "other writer" });
    await act(async () => { await state.save("my draft"); });
    expect(write.mock.calls[0][0]).toMatchObject({ content: "original", revision: originalRevision });
    expect(write.mock.calls[0][1]).toEqual({ op: "updateNote", body: "my draft" });
    expect(errors).toEqual([conflict]); expect(state.isOpen).toBe(true); expect(state.isSaving).toBe(false);
    expect(state.current?.revision).toBe(originalRevision); expect(clears).toBe(0);

    let release!: () => void;
    write.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    let pending!: Promise<void>;
    await act(async () => { pending = state.save("accepted"); await state.save("duplicate"); });
    expect(write).toHaveBeenCalledTimes(2); expect(state.isSaving).toBe(true);
    const oldSave = state.save;
    await act(async () => { state.close(); state.open(target, note); });
    const replacement = state.draftKey;
    await act(async () => { await oldSave("late click"); release(); await pending; });
    expect(write).toHaveBeenCalledTimes(2); expect(state.draftKey).toBe(replacement);
    expect(state.current?.content).toBe("other writer"); expect(state.isOpen).toBe(true);
    expect(state.isSaving).toBe(false);

    await act(async () => { pending = state.save("new draft"); });
    await act(async () => { root.render(<Harness bookId="other" />); });
    await act(async () => { release(); await pending; });
    expect(state.isOpen).toBe(false);
    await act(async () => { state.open(target, note); });
    expect(state.isOpen).toBe(false);
  } finally {
    write.mockRestore(); await act(async () => { root.unmount(); }); dom.window.close();
    for (const [key, value] of globals) {
      if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
