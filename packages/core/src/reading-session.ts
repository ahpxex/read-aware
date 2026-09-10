import type { EventOrigin } from "./entities";
import type { BookTextRange } from "./book-range";

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
  /** Zero-based source reading-order index, not TOC/chapter numbering or a printed page label. Requires contentVersion. */
  sectionIndex?: number;
};

/** Chapter steps follow flattened TOC targets (including subsections); section
 * steps follow linear source sections. Neither interprets printed chapter numbers. */
export type ReadingStep = "next" | "previous" | "next-section" | "previous-section" | "next-chapter" | "previous-chapter" | "start" | "end";

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
  /** Captured from the current reader, never reconstructed from an old annotation. */
  selection: ReadingSelectionSnapshot | null;
  errorCode?: string;
  history: { canGoBack: boolean; canGoForward: boolean };
  playback: ReadingPlaybackSnapshot;
  mode: ReadingModeSnapshot;
  /** Last committed reader-chrome visibility, or null without an attached UI. */
  controls: ReadingControlsSnapshot | null;
};

export type ReadingSelectionSnapshot = {
  id: string;
  /** UTF-16 bounded preview; textLength describes the complete normalized selection. */
  text: string;
  textLength: number;
  range: BookTextRange | null;
  /** A selection can be copied even when its source cannot issue a readable range. */
  rangeUnavailableReason?: "unsupported" | "too-large" | "unavailable";
};

export type ReadingSelectionReceipt = {
  status: "completed";
  sessionId: string;
  selection: ReadingSelectionSnapshot | null;
};

export type ReadingControlsSnapshot = { visible: boolean };
export type ReadingControlsReceipt = { status: "completed"; sessionId: string; controls: ReadingControlsSnapshot };

/** A versioned address independent of the currently visible section. */
export type ReadingModePosition = {
  location: ReadingLocation & { cfi: string };
  modeKey: string;
  unitId: string;
};

/** A registered text-unit mode. No passage text or executable provider is exposed. */
export type ReadingModeDescriptor = { key: string; label: string; units: { id: string; label: string }[]; defaultUnitId: string };

export type ReadingModeSnapshot = {
  /** Ready means the current section is indexed; it is not a navigation receipt. */
  status: "unavailable" | "inactive" | "preparing" | "ready" | "empty" | "error";
  unavailableReason: "no-session" | "unsupported-format" | "no-provider" | null;
  requestedActive: boolean;
  /** Registered choices for this reader; selected modeKey may be temporarily absent. */
  availableModes: ReadingModeDescriptor[];
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

export type ReadingModeConfiguration = {
  active: boolean;
  /** Execution precondition; does not select a provider. */
  modeKey?: string;
  /** Select a registered provider, atomically with active/unitId. */
  selectModeKey?: string;
  unitId?: string;
};
export type ReadingModeReceipt = { status: "completed"; sessionId: string; mode: ReadingModeSnapshot };
export type ReadingModeStepOutcome = "moved" | "start-of-book" | "end-of-book";
export type ReadingModeStepReceipt = ReadingModeReceipt & { outcome: ReadingModeStepOutcome };

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
