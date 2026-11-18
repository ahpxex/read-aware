/**
 * How each fixed-layout book (PDF, comics) was last viewed on this device:
 * its zoom — a fit and a factor over it (see `foliate-js/src/fixed-zoom.ts`)
 * — and where on the page being read the viewport's center rested
 * (`FixedLayout.viewFocus`) — and whether that view is locked, held still
 * across the page while it is read through (`FixedLayout.setViewLocked`). The reading position itself names only the page
 * and roams with the library; this is the rest of the view, which answers to
 * this screen and window and so stays on this device.
 *
 * Keyed by library book id; a book viewed only at the default, from a page's
 * start, has no entry. Writes go through the KV queue, which publishes them
 * optimistically and rolls back — with `local-write-failed` — on failure.
 */
import {
  DEFAULT_FIXED_LAYOUT_ZOOM,
  normalizeFixedLayoutZoom,
  sameFixedLayoutZoom,
  type FixedLayoutZoom,
} from "../../foliate-js/src/fixed-zoom";
import type { ViewFocus } from "../../foliate-js/src/fixed-layout";
import { localKV } from "../platform/local-store";
import type { DomainActor } from "../platform/domain-actor";

export const FIXED_LAYOUT_ZOOM_KEY = "read-aware-fixed-layout-zoom";
export type FixedLayoutView = FixedLayoutZoom & { focus?: ViewFocus; locked?: true };
export type FixedLayoutViews = Record<string, FixedLayoutView>;

function normalizeFocus(value: unknown): ViewFocus | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { index, x, y } = value as Partial<Record<keyof ViewFocus, unknown>>;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) return undefined;
  if (typeof x !== "number" || !Number.isFinite(x) || typeof y !== "number" || !Number.isFinite(y)) return undefined;
  return { index, x, y };
}

function normalizeView(value: unknown): FixedLayoutView {
  const zoom = normalizeFixedLayoutZoom(value);
  const record = value as { focus?: unknown; locked?: unknown } | null;
  const focus = normalizeFocus(record?.focus);
  return { ...zoom, ...(focus ? { focus } : {}), ...(record?.locked === true ? { locked: true as const } : {}) };
}

export function getFixedLayoutViews(): FixedLayoutViews {
  try {
    const parsed: unknown = JSON.parse(localKV.getItem(FIXED_LAYOUT_ZOOM_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).map(([id, view]) => [id, normalizeView(view)]));
  } catch {
    return {}; // A lost view only reopens the book at its default fit, from the page's start.
  }
}

function saveView(bookId: string, view: FixedLayoutView, origin: DomainActor) {
  const views = getFixedLayoutViews();
  const next = { ...views };
  // A default zoom with no place to return to, unlocked, needs no entry.
  if (sameFixedLayoutZoom(view, DEFAULT_FIXED_LAYOUT_ZOOM) && !view.focus && !view.locked) delete next[bookId];
  else next[bookId] = view;
  if (JSON.stringify(next[bookId]) === JSON.stringify(views[bookId])) return;
  localKV.setItem(FIXED_LAYOUT_ZOOM_KEY, JSON.stringify(next), "local", origin);
}

/** Change one part of a book's view record, keeping the rest. */
function updateView(bookId: string, change: Partial<FixedLayoutView>, origin: DomainActor) {
  const { fit, factor, focus, locked } = { ...DEFAULT_FIXED_LAYOUT_ZOOM, ...getFixedLayoutViews()[bookId], ...change };
  saveView(bookId, { fit, factor, ...(focus ? { focus } : {}), ...(locked ? { locked } : {}) }, origin);
}

/** Remember a book's zoom, keeping where it was being read and its lock. */
export function saveFixedLayoutZoom(bookId: string, zoom: FixedLayoutZoom, origin: DomainActor): void {
  updateView(bookId, { fit: zoom.fit, factor: zoom.factor }, origin);
}

/** Remember where on its page a book was being read, keeping its zoom and lock. */
export function saveFixedLayoutFocus(bookId: string, focus: ViewFocus, origin: DomainActor): void {
  updateView(bookId, { focus: normalizeFocus(focus) }, origin);
}

/** Remember whether a book's zoomed view is locked. */
export function saveFixedLayoutLock(bookId: string, locked: boolean, origin: DomainActor): void {
  updateView(bookId, { locked: locked ? true : undefined }, origin);
}
