import { describe, expect, test } from "bun:test";
import { lastSuccessfulSyncAt } from "./sync-status";

describe("lastSuccessfulSyncAt", () => {
  test("returns null before the account has ever synchronized", () => {
    expect(lastSuccessfulSyncAt({ lastPullAt: null, lastPushAt: null })).toBeNull();
  });

  test("uses the newest valid persisted success", () => {
    expect(
      lastSuccessfulSyncAt({
        lastPullAt: "2026-08-21T10:00:00.000Z",
        lastPushAt: "2026-08-21T10:05:00.000Z",
      }),
    ).toBe(Date.parse("2026-08-21T10:05:00.000Z"));
  });

  test("ignores malformed legacy timestamps", () => {
    expect(
      lastSuccessfulSyncAt({
        lastPullAt: "not-a-date",
        lastPushAt: "2026-08-21T10:05:00.000Z",
      }),
    ).toBe(Date.parse("2026-08-21T10:05:00.000Z"));
  });
});
