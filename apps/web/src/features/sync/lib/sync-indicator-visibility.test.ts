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
    expect(
      shouldShowSyncIndicator(
        { accountConnected: false, lastSyncAt: Date.now(), state: "syncing" },
        false,
      ),
    ).toBe(false);
  });

  test("a running cycle is invisible in the header — progress lives in settings", () => {
    expect(
      shouldShowSyncIndicator(
        { accountConnected: true, lastSyncAt: Date.now(), state: "syncing" },
        false,
      ),
    ).toBe(false);
    // The very first sync is no different: the header stays quiet.
    expect(
      shouldShowSyncIndicator(
        { accountConnected: true, lastSyncAt: null, state: "syncing" },
        false,
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

  test("a snoozed error stays hidden, open popover or not", () => {
    expect(
      shouldShowSyncIndicator(
        { accountConnected: true, lastSyncAt: Date.now(), state: "error" },
        false,
        true,
      ),
    ).toBe(false);
    expect(
      shouldShowSyncIndicator(
        { accountConnected: true, lastSyncAt: Date.now(), state: "error" },
        true,
        true,
      ),
    ).toBe(false);
  });

  test("keeps an already-open chip mounted through a follow-up cycle", () => {
    // The chip opened from its error state; the user hits "sync now" in the
    // popover — the popover they are reading must not vanish mid-retry, nor
    // in the idle aftermath, but a fresh mount after closing stays gone.
    expect(
      shouldShowSyncIndicator(
        { accountConnected: true, lastSyncAt: Date.now(), state: "syncing" },
        true,
      ),
    ).toBe(true);
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
