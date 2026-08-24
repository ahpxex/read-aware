import { describe, expect, test } from "bun:test";
import {
  cleanupRelayStorage,
  RATE_WINDOW_RETENTION_MS,
} from "../src/housekeeping";

describe("relay housekeeping", () => {
  test("expires auth artifacts and rate windows from the scheduled instant", async () => {
    const calls: Array<[kind: string, beforeMs: number]> = [];
    const nowMs = 1_755_000_000_000;

    await cleanupRelayStorage(
      {
        cleanupExpired: async (beforeMs) => {
          calls.push(["auth", beforeMs]);
        },
      },
      {
        cleanup: async (beforeMs) => {
          calls.push(["rate", beforeMs]);
        },
      },
      nowMs,
    );

    expect(calls).toEqual([
      ["auth", nowMs],
      ["rate", nowMs - RATE_WINDOW_RETENTION_MS],
    ]);
  });
});
