import { AppError } from "./errors";

export type ReaderPanel = "toc" | "annotations" | "appearance" | "chat";
export type ResizableReaderPanel = "toc" | "chat";
export type ReaderPanelSizes = Record<ResizableReaderPanel, number>;
export const MIN_READER_PANEL_WIDTH = 240;
export const MAX_READER_PANEL_WIDTH = 640;

export function assertReaderPanelWidth(panel: ResizableReaderPanel, width: number): void {
  if (!["toc", "chat"].includes(panel) || !Number.isInteger(width) || width < MIN_READER_PANEL_WIDTH || width > MAX_READER_PANEL_WIDTH) {
    throw new AppError("reader/invalid-target", "Panel width must be an integer from 240 to 640 CSS pixels");
  }
}

/** Committed UI state, not a guarantee that an optimistic preference is durable. */
export type ReaderPanelsView = {
  controlsVisible: boolean;
  /** Preferred CSS-pixel widths, shared across books; ignored in exclusive layout. */
  sizes: ReaderPanelSizes;
  layout: "docked" | "exclusive";
  panels: Record<ReaderPanel, { open: boolean; visible: boolean }>;
};

export type ReaderPanelsSnapshot = ReaderPanelsView & { sessionId: string; bookId: string; revision: number };
export type ReaderPanelReceipt = { status: "completed"; panel: ReaderPanel; snapshot: ReaderPanelsSnapshot };
