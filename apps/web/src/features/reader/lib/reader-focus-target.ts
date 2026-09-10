import type { ReaderFocusOutcome } from "@read-aware/core";

function visible(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[inert],[hidden],[aria-hidden="true"]') || !element.getClientRects().length) return false;
  const view = element.ownerDocument.defaultView;
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = view?.getComputedStyle(node);
    if (style?.display === "none" || style?.visibility === "hidden" || style?.visibility === "collapse" || style?.opacity === "0") return false;
  }
  return true;
}

/** Never dismiss a foreground surface or scroll a hidden panel into view. */
export function focusReaderElement(element: HTMLElement | null): ReaderFocusOutcome {
  if (!element?.isConnected) return { status: "not-focused", reason: "missing" };
  if (!visible(element)) return { status: "not-focused", reason: "hidden" };
  const document = element.ownerDocument;
  for (const overlay of document.querySelectorAll<HTMLElement>('[aria-modal="true"],[role="dialog"],[role="menu"]')) {
    if (!overlay.contains(element) && visible(overlay)) return { status: "not-focused", reason: "blocked" };
  }
  element.focus({ preventScroll: true });
  return document.activeElement === element ? { status: "focused" } : { status: "not-focused", reason: "rejected" };
}
