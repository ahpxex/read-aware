import { afterEach, expect, spyOn, test } from "bun:test";
import { AppError, ERR_EVENT_HLC_CONFLICT } from "@read-aware/core";
import * as ipc from "./ipc";
import { dispatchMinted, retryStampConflicts, type EventRowWire } from "./domain-events";

const restore: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of restore.splice(0).reverse()) cleanup();
});

/** The log frontier another process (the CLI) has moved far ahead. */
const FRONTIER = { deviceId: "device-a", lastHlcWallMs: 4_102_444_800_000, lastHlcCounter: 7 };

function nativeLog() {
  const invoke = spyOn(ipc, "invoke").mockImplementation(async <T>(command: string) => {
    if (command === "local_device_get") return FRONTIER as T;
    throw new Error(`unexpected command ${command}`);
  });
  restore.push(() => invoke.mockRestore());
  return invoke;
}

const conflict = () => new AppError(ERR_EVENT_HLC_CONFLICT, "another event already holds this HLC stamp");
const draft = { type: "book.metadataEdited" as const, payload: { bookId: "b1", title: "T" } };

test("a stamp conflict re-mints past the log frontier and commits the fresh batch", async () => {
  const invoke = nativeLog();
  const batches: EventRowWire[][] = [];
  const result = await dispatchMinted([draft], async (events) => {
    batches.push(events);
    if (batches.length === 1) throw conflict();
    return "committed";
  });
  expect(result).toBe("committed");
  expect(batches).toHaveLength(2);
  const [first, second] = [batches[0]![0]!, batches[1]![0]!];
  expect(second.id).not.toBe(first.id);
  // The retry follows every stamp the log holds, including the other process's.
  expect(
    second.hlc.wallMs > FRONTIER.lastHlcWallMs ||
      (second.hlc.wallMs === FRONTIER.lastHlcWallMs && second.hlc.counter > FRONTIER.lastHlcCounter),
  ).toBe(true);
  expect(invoke.mock.calls.filter(([command]) => command === "local_device_get").length).toBeGreaterThanOrEqual(1);
});

test("other failures are not retried", async () => {
  nativeLog();
  let calls = 0;
  await expect(
    dispatchMinted([draft], async () => {
      calls++;
      throw new AppError("memory/conflict", "revision changed");
    }),
  ).rejects.toMatchObject({ code: "memory/conflict" });
  expect(calls).toBe(1);
});

test("a write that keeps losing its stamps gives up after three attempts", async () => {
  nativeLog();
  let calls = 0;
  await expect(
    retryStampConflicts(async () => {
      calls++;
      throw conflict();
    }),
  ).rejects.toMatchObject({ code: ERR_EVENT_HLC_CONFLICT });
  expect(calls).toBe(3);
});

test("each attempt reruns the write's own checks", async () => {
  nativeLog();
  const checks: number[] = [];
  let attempt = 0;
  await retryStampConflicts(async () => {
    attempt++;
    checks.push(attempt);
    if (attempt === 1) throw conflict();
  });
  expect(checks).toEqual([1, 2]);
});
