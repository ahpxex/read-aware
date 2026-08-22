import { afterEach, beforeEach, describe, expect, test } from "bun:test";

// localKV falls back to localStorage outside Tauri; the bare bun runtime has
// none, so back it with a map the tests control.
const kvBacking = new Map<string, string>();
const realLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;

beforeEach(() => {
  kvBacking.clear();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (key: string) => kvBacking.get(key) ?? null,
    setItem: (key: string, value: string) => void kvBacking.set(key, value),
    removeItem: (key: string) => void kvBacking.delete(key),
  };
});

afterEach(() => {
  (globalThis as Record<string, unknown>).localStorage = realLocalStorage;
});

const {
  SYNC_ERROR_SNOOZE_MS,
  dismissSyncErrorNotice,
  isSyncErrorSnoozedAt,
  readSyncErrorDismissedAt,
} = await import("./sync-error-notice");

describe("sync error notice snooze", () => {
  test("no dismissal means no snooze", () => {
    expect(readSyncErrorDismissedAt()).toBeNull();
    expect(isSyncErrorSnoozedAt(readSyncErrorDismissedAt(), 1000)).toBe(false);
  });

  test("a dismissal snoozes for the full window", () => {
    const dismissedAt = dismissSyncErrorNotice();
    expect(readSyncErrorDismissedAt()).toBe(dismissedAt);
    expect(isSyncErrorSnoozedAt(dismissedAt, dismissedAt + SYNC_ERROR_SNOOZE_MS - 1)).toBe(
      true,
    );
  });

  test("the snooze lapses after the window, so a still-failing sync can resurface", () => {
    const dismissedAt = dismissSyncErrorNotice();
    expect(isSyncErrorSnoozedAt(dismissedAt, dismissedAt + SYNC_ERROR_SNOOZE_MS)).toBe(
      false,
    );
    expect(isSyncErrorSnoozedAt(dismissedAt, dismissedAt + SYNC_ERROR_SNOOZE_MS + 1)).toBe(
      false,
    );
  });

  test("a fresh dismissal overrides an earlier one", () => {
    dismissSyncErrorNotice();
    const again = dismissSyncErrorNotice();
    expect(readSyncErrorDismissedAt()).toBe(again);
  });
});
