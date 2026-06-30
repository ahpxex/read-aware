import { atom } from "jotai";

/**
 * Drag-adjustable widths (px) for the reader's side panels. Persisted globally
 * (a layout preference, not per-book like open/close state) so a chosen width
 * carries across books and sessions.
 */

const STORAGE_KEY = "read-aware-reader-panel-sizes";

export const MIN_PANEL_WIDTH = 240;
export const MAX_PANEL_WIDTH = 640;

export type ReaderPanelSizes = {
  /** Table-of-contents (left) panel width in px. */
  toc: number;
  /** AI chat (right) panel width in px. */
  chat: number;
};

const DEFAULT_SIZES: ReaderPanelSizes = { toc: 288, chat: 352 };

export function clampPanelWidth(px: number): number {
  return Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, Math.round(px)));
}

function readSizes(): ReaderPanelSizes {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SIZES;
    const parsed = JSON.parse(raw) as Partial<ReaderPanelSizes>;
    return {
      toc: typeof parsed.toc === "number" ? clampPanelWidth(parsed.toc) : DEFAULT_SIZES.toc,
      chat: typeof parsed.chat === "number" ? clampPanelWidth(parsed.chat) : DEFAULT_SIZES.chat,
    };
  } catch {
    return DEFAULT_SIZES;
  }
}

export function saveReaderPanelSizes(sizes: ReaderPanelSizes): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sizes));
  } catch {
    // Best-effort: ignore quota / serialization failures.
  }
}

/** Live panel widths. Seeded from storage; the resize handles persist on release. */
export const readerPanelSizesAtom = atom<ReaderPanelSizes>(readSizes());
