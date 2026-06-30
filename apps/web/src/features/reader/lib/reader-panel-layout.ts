/**
 * Per-book reader panel layout — whether the contents (TOC) and notes side
 * panels are open. The reader shell remounts on every book open, so this state
 * would otherwise reset each time; persisting it (keyed by library book id, like
 * `reader-overrides`) lets a book reopen with its panels exactly as left.
 */

const STORAGE_KEY = "read-aware-reader-panels";

/** Which surface the right-hand note panel shows. */
export type NotesTab = "notes" | "chat";

export type ReaderPanelLayout = {
  tocOpen: boolean;
  notesOpen: boolean;
  /** Active tab within the note panel (Notes / AI chat). */
  notesTab: NotesTab;
};

export const DEFAULT_PANEL_LAYOUT: ReaderPanelLayout = {
  tocOpen: false,
  notesOpen: false,
  notesTab: "notes",
};

type PanelLayoutStore = Record<string, ReaderPanelLayout>;

function readStore(): PanelLayoutStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Partial<ReaderPanelLayout>>;
    if (!parsed || typeof parsed !== "object") return {};

    const result: PanelLayoutStore = {};
    for (const [bookId, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object") continue;
      result[bookId] = {
        tocOpen: value.tocOpen === true,
        notesOpen: value.notesOpen === true,
        notesTab: value.notesTab === "chat" ? "chat" : "notes",
      };
    }
    return result;
  } catch {
    return {};
  }
}

export function getReaderPanelLayout(bookId: string): ReaderPanelLayout {
  const stored = readStore()[bookId];
  return stored ? { ...stored } : { ...DEFAULT_PANEL_LAYOUT };
}

export function saveReaderPanelLayout(bookId: string, layout: ReaderPanelLayout): void {
  try {
    const store = readStore();
    store[bookId] = {
      tocOpen: layout.tocOpen,
      notesOpen: layout.notesOpen,
      notesTab: layout.notesTab,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Persisting panel layout is best-effort; ignore quota/serialization errors.
  }
}
