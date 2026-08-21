import { describe, expect, test } from "bun:test";
import { shouldShowSyncIndicator } from "./sync-indicator-visibility";

describe("shouldShowSyncIndicator", () => {
  test("hides every state when no account is connected", () => {
    expect(
      shouldShowSyncIndicator(
        { accountConnected: false, lastSyncAt: Date.now(), state: "error" },
        true,
      ),
    ).toBe(false);
  });

  test("hides an error until the account has synchronized successfully", () => {
    expect(
      shouldShowSyncIndicator(
        { accountConnected: true, lastSyncAt: null, state: "error" },
        false,
      ),
    ).toBe(false);
    expect(
      shouldShowSyncIndicator(
        { accountConnected: true, lastSyncAt: null, state: "error" },
        true,
      ),
    ).toBe(false);
  });

  test("shows a later error after a successful sync", () => {
    expect(
      shouldShowSyncIndicator(
        { accountConnected: true, lastSyncAt: Date.now(), state: "error" },
        false,
      ),
    ).toBe(true);
  });

  test("still shows live progress for the first sync", () => {
    expect(
      shouldShowSyncIndicator(
        { accountConnected: true, lastSyncAt: null, state: "syncing" },
        false,
      ),
    ).toBe(true);
  });

  test("keeps an open idle popover mounted only while connected", () => {
    expect(
      shouldShowSyncIndicator(
        { accountConnected: true, lastSyncAt: Date.now(), state: "idle" },
        true,
      ),
    ).toBe(true);
    expect(
      shouldShowSyncIndicator(
        { accountConnected: true, lastSyncAt: Date.now(), state: "idle" },
        false,
      ),
    ).toBe(false);
  });
});
