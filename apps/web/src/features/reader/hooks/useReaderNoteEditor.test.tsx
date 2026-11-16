import { expect, spyOn, test } from "bun:test";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AppError } from "@read-aware/core";
import * as mutations from "../../annotations/lib/native-annotation-mutations";
import * as annotationDb from "../../annotations/lib/annotation-db";
import type { Note } from "../../annotations/lib/annotation-types";
import { useReaderNoteEditor } from "./useReaderNoteEditor";

type State = ReturnType<typeof useReaderNoteEditor>;

/** Mount the hook in a jsdom root; `run` drives it and the root is torn down after. */
async function withHook(
  run: (ctx: {
    state: () => State;
    render: (bookId?: string) => Promise<void>;
    errors: Array<[unknown, string]>;
    clears: () => number;
  }) => Promise<void>,
) {
  const dom = new JSDOM("<div id='root'></div>", { url: "http://localhost" });
  const values = { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true };
  const globals = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const root = createRoot(dom.window.document.getElementById("root")!);
  const errors: Array<[unknown, string]> = [];
  let state!: State,
    clears = 0;
  function Harness({ bookId }: { bookId: string }) {
    state = useReaderNoteEditor(
      bookId,
      () => {
        clears++;
      },
      (error, action) => {
        errors.push([error, action]);
      },
    );
    return null;
  }
  const render = async (bookId = "book") => {
    await act(async () => {
      root.render(<Harness bookId={bookId} />);
    });
  };
  try {
    await render();
    await run({ state: () => state, render, errors, clears: () => clears });
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
    for (const [key, value] of globals) {
      if (value) Object.defineProperty(globalThis, key, value);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

const note = (overrides: Partial<Note> = {}): Note => ({
  id: "note",
  bookId: "book",
  type: "note",
  text: "passage",
  content: "original",
  cfiRange: "cfi",
  chapterHref: null,
  createdAt: "then",
  updatedAt: "then",
  revision: `ann1:${"a".repeat(64)}`,
  ...overrides,
});
const target = { text: "passage", cfiRange: "cfi", chapterHref: null };
const rect = { left: 10, top: 20, width: 30, height: 12 };

test("an edit pins its token, preserves conflicts, joins one save and isolates replacement cards", async () => {
  const conflict = new AppError("annotations/conflict", "fixture");
  const write = spyOn(mutations, "changeObservedAnnotation").mockRejectedValue(conflict);
  try {
    await withHook(async ({ state, render, errors, clears }) => {
      const edited = note();
      await act(async () => {
        await state().open(target, rect, edited);
      });
      expect(state().anchorRect).toEqual(rect);
      const originalRevision = edited.revision;
      Object.assign(edited, { revision: `ann1:${"b".repeat(64)}`, content: "other writer" });
      await act(async () => {
        state().setText("my draft");
      });
      await act(async () => {
        await state().done();
      });
      expect(write.mock.calls[0][0]).toMatchObject({ content: "original", revision: originalRevision });
      expect(write.mock.calls[0][1]).toEqual({ op: "updateNote", body: "my draft" });
      // A failed save keeps the card open with its text.
      expect(errors).toEqual([[conflict, "save"]]);
      expect(state().isOpen).toBe(true);
      expect(state().isSaving).toBe(false);
      expect(state().text).toBe("my draft");
      expect(state().editing?.revision).toBe(originalRevision);
      expect(clears()).toBe(0);

      let release!: () => void;
      write.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      await act(async () => {
        state().setText("accepted");
      });
      let pending!: Promise<boolean>;
      await act(async () => {
        pending = state().commit();
        void state().commit();
      });
      expect(write).toHaveBeenCalledTimes(2);
      expect(state().isSaving).toBe(true);
      const oldCommit = state().commit;
      await act(async () => {
        state().close();
        await state().open(target, rect, edited);
      });
      const replacement = state().draftKey;
      await act(async () => {
        await oldCommit();
        release();
        await pending;
      });
      expect(write).toHaveBeenCalledTimes(2);
      expect(state().draftKey).toBe(replacement);
      expect(state().editing?.content).toBe("other writer");
      expect(state().isOpen).toBe(true);
      expect(state().isSaving).toBe(false);

      await act(async () => {
        state().setText("new draft");
      });
      await act(async () => {
        pending = state().commit();
      });
      await render("other");
      await act(async () => {
        release();
        await pending;
      });
      expect(state().isOpen).toBe(false);
      await act(async () => {
        await state().open(target, rect, edited);
      });
      expect(state().isOpen).toBe(false);
    });
  } finally {
    write.mockRestore();
  }
});

test("closing saves: a new note is written once, an empty or unchanged draft writes nothing", async () => {
  const create = spyOn(annotationDb, "createNote").mockResolvedValue(note({ id: "created" }));
  const write = spyOn(mutations, "changeObservedAnnotation").mockResolvedValue(undefined);
  try {
    await withHook(async ({ state, clears }) => {
      await act(async () => {
        await state().open(target, rect);
      });
      await act(async () => {
        state().setText("first thought");
      });
      await act(async () => {
        await state().done();
      });
      expect(create).toHaveBeenCalledTimes(1);
      expect(create.mock.calls[0]).toEqual(["book", "cfi", null, "passage", "first thought"]);
      expect(state().isOpen).toBe(false);
      expect(clears()).toBe(1);

      // Nothing written, nothing saved — the card still closes.
      await act(async () => {
        await state().open(target, rect);
      });
      await act(async () => {
        state().setText("   ");
      });
      await act(async () => {
        await state().done();
      });
      expect(create).toHaveBeenCalledTimes(1);
      expect(state().isOpen).toBe(false);

      // An emptied note is not deleted (only Delete deletes), and an unchanged one is not rewritten.
      await act(async () => {
        await state().open(target, rect, note());
      });
      await act(async () => {
        state().setText("");
      });
      await act(async () => {
        await state().done();
      });
      await act(async () => {
        await state().open(target, rect, note());
      });
      await act(async () => {
        await state().done();
      });
      expect(write).not.toHaveBeenCalled();
    });
  } finally {
    create.mockRestore();
    write.mockRestore();
  }
});

test("appending: saving one note leaves the card open for the next, and moving on saves first", async () => {
  const create = spyOn(annotationDb, "createNote").mockResolvedValue(note({ id: "created" }));
  const write = spyOn(mutations, "changeObservedAnnotation").mockResolvedValue(undefined);
  try {
    await withHook(async ({ state }) => {
      await act(async () => {
        await state().open(target, rect);
      });
      await act(async () => {
        state().setText("one");
      });
      // Switching to edit an existing note saves the new one first.
      await act(async () => {
        await state().edit(note());
      });
      expect(create).toHaveBeenCalledTimes(1);
      expect(state().isOpen).toBe(true);
      expect(state().editing?.id).toBe("note");
      expect(state().text).toBe("original");

      await act(async () => {
        state().setText("original, revised");
      });
      // Opening another passage saves the open card before moving.
      const elsewhere = { text: "another passage", cfiRange: "cfi-2", chapterHref: null };
      await act(async () => {
        await state().open(elsewhere, null);
      });
      expect(write).toHaveBeenCalledTimes(1);
      expect(write.mock.calls[0][1]).toEqual({ op: "updateNote", body: "original, revised" });
      expect(state().target?.cfiRange).toBe("cfi-2");
      expect(state().editing).toBe(null);
      expect(state().text).toBe("");
    });
  } finally {
    create.mockRestore();
    write.mockRestore();
  }
});

test("a failed save keeps the passage card; a failed delete reports as a delete", async () => {
  const failure = new AppError("annotations/unavailable", "fixture");
  const create = spyOn(annotationDb, "createNote").mockRejectedValue(failure);
  const write = spyOn(mutations, "changeObservedAnnotation").mockRejectedValue(failure);
  try {
    await withHook(async ({ state, errors }) => {
      await act(async () => {
        await state().open(target, rect);
      });
      await act(async () => {
        state().setText("keep me");
      });
      // Opening another passage cannot proceed past a failed save: the text stays.
      await act(async () => {
        await state().open({ text: "x", cfiRange: "cfi-2", chapterHref: null }, null);
      });
      expect(state().target?.cfiRange).toBe("cfi");
      expect(state().text).toBe("keep me");
      expect(errors).toEqual([[failure, "save"]]);

      await act(async () => {
        await state().remove(note());
      });
      expect(write.mock.calls[0][1]).toEqual({ op: "remove" });
      expect(errors[1]).toEqual([failure, "delete"]);
      expect(state().isOpen).toBe(true);
    });
  } finally {
    create.mockRestore();
    write.mockRestore();
  }
});
