import { normalizeBookRangeQuery, type ReadingSelectionSnapshot } from "@read-aware/core";
import type { FoliateView } from "./foliate-engine";

export type SelectionContentIdentity = {
  view: FoliateView;
  sessionId: string;
  bookId: string;
  contentVersion: string;
};

/** Capture synchronously while the displayed parser and DOM range still agree. */
export function captureReadingSelection(identity: SelectionContentIdentity | null, view: FoliateView,
  index: number, range: Range, text: string): ReadingSelectionSnapshot {
  let end = Math.min(text.length, 12000);
  if (end < text.length && /[\uD800-\uDBFF]/u.test(text[end - 1]) && /[\uDC00-\uDFFF]/u.test(text[end])) end--;
  const snapshot: ReadingSelectionSnapshot = { id: crypto.randomUUID(), text: text.slice(0, end), textLength: text.length, range: null };
  if (!identity || identity.view !== view) return { ...snapshot, rangeUnavailableReason: "unavailable" };
  try {
    const captured = view.getTextRange(index, range);
    if (captured.textQuote && captured.textQuote.exact.length > 12000) return { ...snapshot, rangeUnavailableReason: "too-large" };
    snapshot.range = normalizeBookRangeQuery({ range: { bookId: identity.bookId, contentVersion: identity.contentVersion, ...captured } }).range;
    return snapshot;
  } catch {
    // Native copy/lookup still works for a selection with no portable source anchor.
    return { ...snapshot, rangeUnavailableReason: "unsupported" };
  }
}
