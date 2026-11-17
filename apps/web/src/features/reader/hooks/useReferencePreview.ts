import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppError } from "@read-aware/core";
import { readingRuntime } from "../../../domain/reading-runtime";
import { readerReferencePreview } from "../../../services/reader-reference-preview";
import { PendingIntentSlot } from "../../../platform/pending-intent";
import type { SelectionOverlayRect } from "../lib/selection-overlay";

type Footnote = { anchorRect: SelectionOverlayRect | null; label: string; text: string; previewId?: string };
type Commit = { id: string; opening: boolean };

/** Bridges native clicks and API requests into the same committed React surface. */
export function useReferencePreview(bookId: string | undefined, fallbackLabel: string) {
  const [footnote, setValue] = useState<Footnote | null>(null);
  const [, requestCommit] = useState(0);
  const nativeInterrupt = useRef(() => {});
  const revision = useRef(0);
  const [pending] = useState(
    () =>
      new PendingIntentSlot<Commit, void>({
        deadlineMs: 10_000,
        timeout: () => new AppError("reader/timeout", "Preview did not commit"),
        superseded: () => new AppError("reader/superseded", "Preview commit replaced"),
      }),
  );
  const label = useRef(fallbackLabel);
  label.current = fallbackLabel;
  const clearCommit = useCallback((error: unknown) => pending.cancel(error), [pending]);
  useLayoutEffect(() => {
    const intent = pending.current;
    if (intent && (footnote?.previewId === intent.payload.id) === intent.payload.opening)
      pending.confirm(intent, undefined);
  });
  useEffect(() => {
    let unbind = () => {},
      sessionId: string | null = null;
    let alive = true;
    function apply(id: string, opening: boolean, value: Footnote | null, signal?: AbortSignal): Promise<void> {
      if (!alive)
        return opening
          ? Promise.reject(new AppError("reader/unavailable", "Preview renderer detached"))
          : Promise.resolve();
      signal?.throwIfAborted();
      const { settled } = pending.begin({ id, opening }, signal);
      setValue((previous) => (opening ? value : previous?.previewId === id ? null : previous));
      requestCommit((value) => value + 1);
      return settled;
    }
    const stop = readingRuntime.observe((state) => {
      const id = state.status === "ready" && state.bookId === bookId ? state.sessionId : null;
      if (id === sessionId) return;
      unbind();
      revision.current++;
      nativeInterrupt.current = () => {};
      sessionId = id;
      clearCommit(new AppError("reader/superseded", "Preview session ended"));
      setValue(null);
      if (id && bookId) {
        const binding = readerReferencePreview.bind(id, bookId, {
          begin: () => {
            revision.current++;
          },
          present: (view, signal) =>
            apply(
              view.id,
              true,
              {
                previewId: view.id,
                anchorRect: null,
                label: view.preview.label || label.current,
                text: `${view.preview.offset > 0 ? "..." : ""}${view.preview.text}${view.preview.nextOffset !== null ? "..." : ""}`,
              },
              signal,
            ),
          clear: (id) => apply(id, false, null),
        });
        unbind = binding.dispose;
        nativeInterrupt.current = binding.interrupt;
      }
    });
    return () => {
      alive = false;
      // oxlint-disable-next-line react-hooks/exhaustive-deps -- revision is a generation counter, not a node: cleanup bumps the live value
      revision.current++;
      stop();
      unbind();
      nativeInterrupt.current = () => {};
      clearCommit(new AppError("reader/superseded", "Preview renderer unmounted"));
    };
  }, [bookId, clearCommit, pending]);
  const beginNativeFootnote = useCallback(() => {
    nativeInterrupt.current();
    clearCommit(new AppError("reader/superseded", "A native preview intent replaced the request"));
    return ++revision.current;
  }, [clearCommit]);
  const setFootnote = useCallback(
    (value: Footnote | null, expectedRevision?: number) => {
      if (expectedRevision !== undefined && expectedRevision !== revision.current) return;
      beginNativeFootnote();
      setValue(value);
    },
    [beginNativeFootnote],
  );
  const closeFootnote = useCallback(() => setFootnote(null), [setFootnote]);
  return { footnote, setFootnote, closeFootnote, beginNativeFootnote };
}
