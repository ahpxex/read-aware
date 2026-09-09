export type ReaderPanel = "toc" | "annotations" | "appearance" | "chat";

/** Committed UI state, not a guarantee that an optimistic preference is durable. */
export type ReaderPanelsView = {
  controlsVisible: boolean;
  panels: Record<ReaderPanel, { open: boolean; visible: boolean }>;
};

export type ReaderPanelsSnapshot = ReaderPanelsView & { sessionId: string; bookId: string; revision: number };
export type ReaderPanelReceipt = { status: "completed"; panel: ReaderPanel; snapshot: ReaderPanelsSnapshot };
