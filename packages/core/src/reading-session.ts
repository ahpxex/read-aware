import type { EventOrigin } from "./entities";

/** Serializable reading state shared by the host, plugins and the product Agent. */
export type ReadingTextQuote = { exact: string; prefix?: string; suffix?: string };

export type ReadingLocation = {
  bookId: string;
  /** Source hash when available; otherwise a session-scoped content revision. */
  contentVersion: string;
  cfi?: string;
  href?: string;
  fraction?: number;
  /** Resolve against the rendered text layer, e.g. an unrendered PDF search hit. */
  textQuote?: ReadingTextQuote;
};

export type ReadingTarget = {
  bookId?: string;
  contentVersion?: string;
  cfi?: string;
  href?: string;
  fraction?: number;
  textQuote?: ReadingTextQuote;
};

/** Optional execution preconditions, not a replacement for actor authorization. */
export type ReadingSessionGuard = {
  bookId?: string;
  sessionId?: string;
};

export type ReadingSessionSnapshot = {
  revision: number;
  sessionId: string | null;
  bookId: string | null;
  status: "idle" | "loading" | "ready" | "error";
  location: ReadingLocation | null;
  visibleText: string;
  errorCode?: string;
  history: { canGoBack: boolean; canGoForward: boolean };
  playback: ReadingPlaybackSnapshot;
  mode: ReadingModeSnapshot;
};

/** A versioned address independent of the currently visible section. */
export type ReadingModePosition = {
  location: ReadingLocation & { cfi: string };
  modeKey: string;
  unitId: string;
};

/** The current host-supported text-unit mode. No passage text or executable provider is exposed. */
export type ReadingModeSnapshot = {
  /** Ready means the current section is indexed; it is not a navigation receipt. */
  status: "unavailable" | "inactive" | "preparing" | "ready" | "empty" | "error";
  unavailableReason: "no-session" | "unsupported-format" | "no-provider" | null;
  requestedActive: boolean;
  modeKey: string | null;
  label: string | null;
  unitId: string | null;
  units: { id: string; label: string }[];
  /** Zero-based position in the indexed section, not the whole book. */
  progress: { ordinal: number; total: number } | null;
  cfiRange: string | null;
  /** The resting unit remains addressable when ordinary navigation leaves its section. */
  position: ReadingModePosition | null;
  errorCode?: string;
};

export type ReadingModeConfiguration = { active: boolean; modeKey?: string; unitId?: string };
export type ReadingModeReceipt = { status: "completed"; sessionId: string; mode: ReadingModeSnapshot };

/** Text is deliberately omitted: playback control grants no additional reading access. */
export type ReadingPlaybackSnapshot = {
  status: "unavailable" | "stopped" | "preparing" | "playing" | "advancing" | "error";
  unavailableReason: "no-session" | "mode-inactive" | "no-voice" | "no-unit" | null;
  backend: "plugin" | "system" | null;
  fallback: boolean;
  owner: EventOrigin | null;
  cfiRange: string | null;
  errorCode?: string;
};

export type ReadingPlaybackReceipt = {
  status: "completed";
  sessionId: string;
  playback: ReadingPlaybackSnapshot;
};

export type ReadingNavigationReceipt = {
  status: "completed";
  sessionId: string;
  location: ReadingLocation;
};
