import { describe, expect, test } from "bun:test";
import {
  getSyncConnectionBusy,
  runSyncConnectionOperation,
  subscribeSyncConnectionBusy,
  SyncConnectionBusyError,
} from "./connection-operation";

describe("sync connection operation gate", () => {
  test("serializes operations across callers and publishes busy state", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const states: boolean[] = [];
    const unsubscribe = subscribeSyncConnectionBusy(() => {
      states.push(getSyncConnectionBusy());
    });

    const first = runSyncConnectionOperation(async () => {
      await held;
      return "first";
    });
    expect(getSyncConnectionBusy()).toBe(true);
    await expect(runSyncConnectionOperation(async () => "second")).rejects.toThrow(
      SyncConnectionBusyError,
    );

    release();
    expect(await first).toBe("first");
    expect(getSyncConnectionBusy()).toBe(false);
    expect(states).toEqual([true, false]);

    expect(await runSyncConnectionOperation(async () => "third")).toBe("third");
    unsubscribe();
  });
});
