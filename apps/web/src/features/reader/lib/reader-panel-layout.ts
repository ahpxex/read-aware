/**
 * Per-book reader panel layout — whether the contents (TOC) and notes side
 * panels are open. The reader shell remounts on every book open, so this state
 * would otherwise reset each time; persisting it (keyed by library book id, like
 * `reader-overrides`) lets a book reopen with its panels exactly as left.
 */

import { AppError } from "@read-aware/core";
import { afterLocalKVWrites, localKV, onLocalKVChange } from "../../../platform/local-store";

const STORAGE_KEY = "read-aware-reader-panels";

export type ReaderPanelLayout = {
  tocOpen: boolean;
  /** Whether the right-hand AI chat panel is open. */
  notesOpen: boolean;
};

export const DEFAULT_PANEL_LAYOUT: ReaderPanelLayout = {
  tocOpen: false,
  notesOpen: false,
};

type PanelLayoutStore = Record<string, ReaderPanelLayout>;

function readStore(raw: string | null): PanelLayoutStore {
  try {
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Partial<ReaderPanelLayout>>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const result: PanelLayoutStore = Object.create(null);
    for (const [bookId, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      result[bookId] = {
        tocOpen: value.tocOpen === true,
        notesOpen: value.notesOpen === true,
      };
    }
    return result;
  } catch {
    // Malformed legacy preferences fall back to the default panel layout.
    return {};
  }
}

export const readerPanelLayoutStore = {
  getSnapshot: (): string | null => localKV.getItem(STORAGE_KEY),
  subscribe: (listener: () => void): (() => void) => onLocalKVChange(key => {
    if (key === STORAGE_KEY) listener();
  }),
};

export function getReaderPanelLayout(bookId: string, raw = readerPanelLayoutStore.getSnapshot()): ReaderPanelLayout {
  const store = readStore(raw);
  const stored = Object.hasOwn(store, bookId) ? store[bookId] : undefined;
  return stored ? { ...stored } : { ...DEFAULT_PANEL_LAYOUT };
}

/** Patch settled state, preserving other books and resolving only after SQLite commits. */
export function updateReaderPanelLayout(
  bookId: string,
  update: (previous: Readonly<ReaderPanelLayout>) => ReaderPanelLayout,
  signal?: AbortSignal,
): Promise<ReaderPanelLayout> {
  const work = afterLocalKVWrites(() => {
    signal?.throwIfAborted();
    if (typeof bookId !== "string" || !bookId) throw new AppError("reader/invalid-target", "Panel layout requires a book");
    const raw = readerPanelLayoutStore.getSnapshot();
    const previous = getReaderPanelLayout(bookId, raw);
    const next = update({ ...previous });
    if (typeof next?.tocOpen !== "boolean" || typeof next?.notesOpen !== "boolean") {
      throw new AppError("reader/invalid-target", "Panel layout requires boolean values");
    }
    const layout = { tocOpen: next.tocOpen, notesOpen: next.notesOpen };
    if (layout.tocOpen === previous.tocOpen && layout.notesOpen === previous.notesOpen) return layout;
    const store = readStore(raw);
    Object.defineProperty(store, bookId, { value: layout, enumerable: true, configurable: true, writable: true });
    return localKV.setItemAsync(STORAGE_KEY, JSON.stringify(store)).then(() => layout);
  });
  if (!signal) return work;
  // Cancellation settles the caller promptly; it cannot undo an IPC write that
  // has already started. The queued operation checks again before reading/writing.
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    void work.then(value => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(signal.reason); else resolve(value);
    }, error => { signal.removeEventListener("abort", abort); reject(error); });
  });
}
