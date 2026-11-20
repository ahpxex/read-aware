import type { Overlayer } from "./overlayer.js";

export type RelocateReason = "page" | "snap" | "scroll" | "anchor" | "navigation" | "selection";
export type RelocateDetail = {
  reason: RelocateReason | null;
  range: Range | null;
  index: number;
  fraction?: number;
  size?: number;
  context?: object;
};
/** READAWARE: a turn that found nothing beyond the book's first or last page. */
export type EdgeDetail = { dir: -1 | 1; context?: object };
export type Content = { doc: Document; index: number; overlayer?: Overlayer };
export type LoadDetail = { doc: Document; index: number; context?: object };
export type CreateOverlayerDetail = LoadDetail & { attach: (overlayer: Overlayer) => void };

/** Host-only provenance for browser feedback. Contexts remain opaque to the
 * renderer; this is not exposed to books or plugins. */
export type NativeInputBridge = {
  context(event: Event): object;
  selectionChanged(doc: Document, context: object): void;
  focusDocument(doc: Document, context: object): void;
  /** Whether this selection change is one the host made and already handled, not the reader dragging. */
  ownsSelection?(doc: Document, event: Event): boolean;
};
