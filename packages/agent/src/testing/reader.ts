import type { ReadingLocation, ReadingNavigationReceipt, ReadingPlaybackSnapshot, ReadingModeSnapshot } from "@read-aware/core";
import type { ReaderPort } from "../ports";

export type ReaderRequest = { type: "open" | "goTo" | "back" | "forward" | "step" | "close"; bookId?: string; anchor?: string; chapterHref?: string; direction?: string };

/** Port fixture only; physical renderer behavior is tested in the host controller suite. */
export function createMemoryReader(initialBookId: string | undefined, requests: ReaderRequest[]): ReaderPort {
  const playback: ReadingPlaybackSnapshot = { status: "unavailable", unavailableReason: "no-voice", backend: null, fallback: false, owner: null, cfiRange: null };
  const mode: ReadingModeSnapshot = { status: "unavailable", unavailableReason: "no-provider", requestedActive: false,
    modeKey: null, label: null, availableModes: [], unitId: null, units: [], progress: null, cfiRange: null, position: null };
  let revision = 0;
  let controls = { visible: false };
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
    return { status: "completed", sessionId: "fixture", location: { ...location } };
  };
  return {
    getPanels: async () => location ? { sessionId: "fixture", bookId: location.bookId, revision, controlsVisible: controls.visible, panels: structuredClone(panels) } : null,
    setPanel: async (panel, open) => {
      if (!location) throw new Error("No active fixture reader");
      if (open) showControls(true);
      panels[panel] = { open, visible: open && controls.visible }; revision++;
      return { status: "completed", panel, snapshot: { sessionId: "fixture", bookId: location.bookId, revision, controlsVisible: controls.visible, panels: structuredClone(panels) } };
    },
    getSession: async () => ({ revision, sessionId: location ? "fixture" : null, bookId: location?.bookId ?? null, status: location ? "ready" : "idle", location, visibleText: "", selection: null, history: { canGoBack: false, canGoForward: false }, playback, mode, controls: location ? { ...controls } : null }),
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
    openBook: async bookId => { requests.push({ type: "open", bookId }); location = { bookId, contentVersion: "fixture", fraction: 0 }; return receipt(); },
    goTo: async target => {
      requests.push({ type: "goTo", bookId: target.bookId, anchor: target.cfi, chapterHref: target.href });
      const bookId = target.bookId ?? location?.bookId;
      if (!bookId) throw new Error("No active fixture reader");
      location = { ...target, bookId, contentVersion: target.contentVersion ?? "fixture" }; return receipt();
    },
    step: async direction => { requests.push({ type: "step", direction }); return receipt(); },
    back: async () => { throw new Error("No fixture navigation history"); },
    forward: async () => { throw new Error("No fixture navigation history"); },
    close: async () => { requests.push({ type: "close" }); location = null; revision++; },
  };
}
