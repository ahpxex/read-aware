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
};

export type ReadingNavigationReceipt = {
  status: "completed";
  sessionId: string;
  location: ReadingLocation;
};
