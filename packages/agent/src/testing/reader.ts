import type { ReadingLocation, ReadingNavigationReceipt, ReadingPlaybackSnapshot, ReadingModeSnapshot } from "@read-aware/core";
import type { ReaderPort } from "../ports";
import { AppError, normalizeBookRangeQuery, type ReadingSelectionSnapshot, type ReadingSessionGuard } from "@read-aware/core";
import { normalizeReadingEmphasisWrite, normalizeReadingEmphasisRef, type ReadingEmphasisSnapshot } from "@read-aware/core";

export type ReaderRequest = { type: "open" | "goTo" | "back" | "forward" | "step" | "close"; bookId?: string; anchor?: string; chapterHref?: string; direction?: string };

/** Port fixture only; physical renderer behavior is tested in the host controller suite. */
export function createMemoryReader(initialBookId: string | undefined, requests: ReaderRequest[]): ReaderPort {
  const playback: ReadingPlaybackSnapshot = { status: "unavailable", unavailableReason: "no-voice", backend: null, fallback: false, owner: null, cfiRange: null };
  const mode: ReadingModeSnapshot = { status: "unavailable", unavailableReason: "no-provider", requestedActive: false,
    modeKey: null, label: null, availableModes: [], unitId: null, units: [], progress: null, cfiRange: null, position: null };
  let revision = 0;
  let selection: ReadingSelectionSnapshot | null = null;
  const emphasis = new Map<string, ReadingEmphasisSnapshot>();
  let controls = { visible: false };
  const sizes = { toc: 288, chat: 352 };
  const panels = { toc: { open: false, visible: false }, chat: { open: false, visible: false }, annotations: { open: false, visible: false }, appearance: { open: false, visible: false } };
  const showControls = (visible: boolean) => {
    controls = { visible };
    if (!visible) { panels.annotations.open = false; panels.appearance.open = false; }
    for (const panel of Object.values(panels)) panel.visible = visible && panel.open;
  };
  let location: ReadingLocation | null = initialBookId ? { bookId: initialBookId, contentVersion: "fixture", fraction: 0 } : null;
  const receipt = (): ReadingNavigationReceipt => {
    if (!location) throw new Error("No active fixture reader");
    revision++;
    selection = null;
    return { status: "completed", sessionId: "fixture", location: { ...location } };
  };
  const checkSelection = (signal?: AbortSignal, guard?: ReadingSessionGuard) => {
    signal?.throwIfAborted();
    if (!location) throw new AppError("reader/unavailable", "No active fixture reader");
    if (guard?.sessionId !== undefined && guard.sessionId !== "fixture"
      || guard?.bookId !== undefined && guard.bookId !== location.bookId) throw new AppError("reader/superseded", "Fixture session changed");
  };
  return {
    previewReference: async () => { throw new AppError("reader/unavailable", "Fixture has no native reference preview"); },
    closeReferencePreview: async (_owner, id) => ({ status: "not-current", id }),
    listEmphasis: async () => structuredClone([...emphasis.values()]),
    putEmphasis: async (input, signal, guard) => {
      checkSelection(signal, guard); const value = normalizeReadingEmphasisWrite(input);
      if (value.ranges[0].bookId !== location!.bookId) throw new AppError("reader/out-of-scope", "Open the fixture book first");
      if (value.ranges[0].contentVersion !== location!.contentVersion) throw new AppError("reader/stale-location", "Fixture source changed");
      if (value.id && emphasis.get(value.id)?.revision !== value.expectedRevision) throw new AppError("reader/superseded", "Fixture emphasis changed");
      const snapshot: ReadingEmphasisSnapshot = { id: value.id ?? crypto.randomUUID(), revision: ++revision, sessionId: "fixture", bookId: location!.bookId,
        style: value.style, count: value.ranges.length, attached: value.ranges.length, status: "attached" };
      emphasis.set(snapshot.id, snapshot); return { status: "completed", emphasis: structuredClone(snapshot) };
    },
    removeEmphasis: async (input, signal, guard) => {
      checkSelection(signal, guard); const ref = normalizeReadingEmphasisRef(input), previous = emphasis.get(ref.id);
      if (previous && previous.revision !== ref.expectedRevision) throw new AppError("reader/superseded", "Fixture emphasis changed");
      return { status: "completed", id: ref.id, removed: emphasis.delete(ref.id) };
    },
    selectRange: async (input, signal, guard) => {
      const range = normalizeBookRangeQuery({ range: input }).range;
      checkSelection(signal, guard);
      if (range.bookId !== location!.bookId) throw new AppError("reader/out-of-scope", "Open the fixture book first");
      if (range.contentVersion !== location!.contentVersion) throw new AppError("reader/stale-location", "Fixture content changed");
      const text = range.textQuote?.exact ?? "Fixture selection";
      selection = { id: crypto.randomUUID(), text, textLength: text.length, range };
      location = range; revision++;
      return { status: "completed", sessionId: "fixture", selection: structuredClone(selection) };
    },
    clearSelection: async (expectedId, signal, guard) => {
      checkSelection(signal, guard);
      if (!selection || selection.id !== expectedId) throw new AppError("reader/superseded", "Fixture selection changed");
      selection = null; revision++;
      return { status: "completed", sessionId: "fixture", selection: null };
    },
    getPanels: async () => location ? { sessionId: "fixture", bookId: location.bookId, revision, controlsVisible: controls.visible, sizes: { ...sizes }, layout: "docked", panels: structuredClone(panels) } : null,
    setPanelWidth: async (panel, width, signal, guard) => {
      checkSelection(signal, guard);
      sizes[panel] = width; revision++;
      return { status: "completed", panel, snapshot: { sessionId: "fixture", bookId: location!.bookId, revision, controlsVisible: controls.visible, sizes: { ...sizes }, layout: "docked", panels: structuredClone(panels) } };
    },
    setPanel: async (panel, open) => {
      if (!location) throw new Error("No active fixture reader");
      if (open) showControls(true);
      panels[panel] = { open, visible: open && controls.visible }; revision++;
      return { status: "completed", panel, snapshot: { sessionId: "fixture", bookId: location.bookId, revision, controlsVisible: controls.visible, sizes: { ...sizes }, layout: "docked", panels: structuredClone(panels) } };
    },
    getSession: async () => ({ revision, sessionId: location ? "fixture" : null, bookId: location?.bookId ?? null, status: location ? "ready" : "idle", location, visibleText: "", selection: structuredClone(selection), history: { canGoBack: false, canGoForward: false }, playback, mode, controls: location ? { ...controls } : null }),
    setControls: async visible => {
      if (!location) throw new Error("No active fixture reader");
      showControls(visible); revision++;
      return { status: "completed", sessionId: "fixture", controls: { ...controls } };
    },
    configureMode: async input => {
      if (input.active) throw new Error("Fixture has no reader-mode provider");
      return { status: "completed", sessionId: "fixture", mode };
    },
    returnToMode: async () => { throw new Error("Fixture has no reader-mode position"); },
    stepMode: async () => { throw new Error("Fixture has no reader-mode units"); },
    controlPlayback: async action => {
      if (action === "start") throw new Error("Fixture has no audio backend");
      return { status: "completed", sessionId: "fixture", playback };
    },
    openBook: async bookId => { requests.push({ type: "open", bookId }); if (location?.bookId !== bookId) emphasis.clear(); location = { bookId, contentVersion: "fixture", fraction: 0 }; return receipt(); },
    goTo: async target => {
      requests.push({ type: "goTo", bookId: target.bookId, anchor: target.cfi, chapterHref: target.href });
      const bookId = target.bookId ?? location?.bookId;
      if (!bookId) throw new Error("No active fixture reader");
      location = { ...target, bookId, contentVersion: target.contentVersion ?? "fixture" }; return receipt();
    },
    step: async direction => { requests.push({ type: "step", direction }); return receipt(); },
    back: async () => { throw new Error("No fixture navigation history"); },
    forward: async () => { throw new Error("No fixture navigation history"); },
    close: async () => { requests.push({ type: "close" }); location = null; selection = null; emphasis.clear(); revision++; },
  };
}
