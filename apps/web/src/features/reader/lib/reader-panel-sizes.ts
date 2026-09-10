import { atom } from "jotai";
import { assertReaderPanelWidth, MIN_READER_PANEL_WIDTH, MAX_READER_PANEL_WIDTH, type ReaderPanelSizes, type ResizableReaderPanel } from "@read-aware/core";

/**
 * Drag-adjustable widths (px) for the reader's side panels. Persisted globally
 * (a layout preference, not per-book like open/close state) so a chosen width
 * carries across books and sessions.
 */

import { afterLocalKVWrites, localKV, onLocalKVChange } from "../../../platform/local-store";

const STORAGE_KEY = "read-aware-reader-panel-sizes";

export const MIN_PANEL_WIDTH = MIN_READER_PANEL_WIDTH;
export const MAX_PANEL_WIDTH = MAX_READER_PANEL_WIDTH;

export type { ReaderPanelSizes } from "@read-aware/core";

const DEFAULT_SIZES: ReaderPanelSizes = { toc: 288, chat: 352 };

export function clampPanelWidth(px: number): number {
  return Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, Math.round(px)));
}

export function readReaderPanelSizes(): ReaderPanelSizes {
  try {
    const raw = localKV.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SIZES };
    const parsed = JSON.parse(raw) as Partial<ReaderPanelSizes>;
    return {
      toc: Number.isFinite(parsed.toc) ? clampPanelWidth(parsed.toc!) : DEFAULT_SIZES.toc,
      chat: Number.isFinite(parsed.chat) ? clampPanelWidth(parsed.chat!) : DEFAULT_SIZES.chat,
    };
  } catch {
    // Malformed legacy preferences use the existing defaults.
    return { ...DEFAULT_SIZES };
  }
}

export function updateReaderPanelWidth(panel: ResizableReaderPanel, width: number, signal?: AbortSignal): Promise<void> {
  assertReaderPanelWidth(panel, width);
  return afterLocalKVWrites(async () => {
    signal?.throwIfAborted();
    await localKV.setItemAsync(STORAGE_KEY, JSON.stringify({ ...readReaderPanelSizes(), [panel]: width }));
    signal?.throwIfAborted();
  });
}

/** Live panel widths. Seeded from storage; the resize handles persist on release. */
export const readerPanelSizesAtom = atom<ReaderPanelSizes>(readReaderPanelSizes());
readerPanelSizesAtom.onMount = set => {
  set(readReaderPanelSizes());
  return onLocalKVChange(key => { if (key === STORAGE_KEY) set(readReaderPanelSizes()); });
};
