import type { ReadingLocation, ReadingNavigationReceipt } from "@read-aware/core";
import type { ReaderPort } from "../ports";

export type ReaderRequest = { type: "open" | "goTo" | "back" | "forward" | "step" | "close"; bookId?: string; anchor?: string; chapterHref?: string; direction?: string };

/** Port fixture only; physical renderer behavior is tested in the host controller suite. */
export function createMemoryReader(initialBookId: string | undefined, requests: ReaderRequest[]): ReaderPort {
  let revision = 0;
  let location: ReadingLocation | null = initialBookId ? { bookId: initialBookId, contentVersion: "fixture", fraction: 0 } : null;
  const receipt = (): ReadingNavigationReceipt => {
    if (!location) throw new Error("No active fixture reader");
    revision++;
    return { status: "completed", sessionId: "fixture", location: { ...location } };
  };
  return {
    getSession: async () => ({ revision, sessionId: location ? "fixture" : null, bookId: location?.bookId ?? null, status: location ? "ready" : "idle", location, visibleText: "", history: { canGoBack: false, canGoForward: false } }),
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
