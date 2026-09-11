import { expect, test } from "bun:test";
import { createCloseCoordination, installCloseCoordination, type CloseAdapter } from "./window-close";
import type { ShutdownReceipt } from "../services/shutdown";

function fixture() {
  const calls: string[] = [], reports: string[] = [];
  let prepareGate: Promise<void> | undefined, prepareFailure: Error | undefined, destroyFailure: Error | undefined;
  const receipt: ShutdownReceipt = { status: "ready", owners: [], elapsedMs: 1 };
  let closeHandler: ((event: { preventDefault(): void }) => Promise<void> | void) | undefined, exitHandler: (() => Promise<void> | void) | undefined;
  const adapter: CloseAdapter = {
    onCloseRequested: async handler => { closeHandler = handler; return () => { closeHandler = undefined; }; },
    onExitRequested: async handler => { exitHandler = handler; return () => { exitHandler = undefined; }; },
    destroy: async () => { calls.push("destroy"); if (destroyFailure) throw destroyFailure; },
    confirmExit: async () => { calls.push("confirm-exit"); },
  };
  const coordinator = { prepare: async () => { calls.push("prepare"); if (prepareGate) await prepareGate; if (prepareFailure) throw prepareFailure; return receipt; } };
  const coordination = createCloseCoordination(adapter, coordinator, message => { reports.push(message); });
  return { adapter, coordinator, coordination, calls, reports, gate: (gate: Promise<void>) => { prepareGate = gate; },
    failPrepare: (error: Error) => { prepareFailure = error; }, failDestroy: (error: Error) => { destroyFailure = error; },
    handlers: () => ({ close: closeHandler, exit: exitHandler }) };
}
const event = () => { const value = { prevented: 0, preventDefault() { value.prevented++; } }; return value; };

test("a close request prevents the default, flushes once and destroys; requests during the flush are absorbed", async () => {
  const f = fixture(), gate = Promise.withResolvers<void>(), first = event(), second = event();
  f.gate(gate.promise);
  const closing = f.coordination.closeRequested(first);
  const again = f.coordination.closeRequested(second);
  expect(first.prevented).toBe(1); expect(second.prevented).toBe(1); expect(f.coordination.closing).toBe(true);
  expect(again).toBe(closing);
  await Bun.sleep(0); expect(f.calls).toEqual(["prepare"]);
  gate.resolve(); await closing;
  expect(f.calls).toEqual(["prepare", "destroy"]); expect(f.reports).toEqual([]);
  await f.coordination.exitRequested();
  expect(f.calls).toEqual(["prepare", "destroy"]);
});

test("a failed flush still closes, a failed native close reopens the coordination, and quit confirms instead of destroying", async () => {
  const f = fixture();
  f.failPrepare(new Error("PRIVATE FLUSH FAILURE")); f.failDestroy(new Error("PRIVATE DESTROY FAILURE"));
  await f.coordination.closeRequested(event());
  expect(f.calls).toEqual(["prepare", "destroy"]);
  expect(f.reports).toEqual(["Shutdown preparation failed; closing anyway", "Native close after preparation failed"]);
  expect(f.coordination.closing).toBe(false);
  f.failDestroy(undefined as never);
  await f.coordination.exitRequested();
  expect(f.calls).toEqual(["prepare", "destroy", "prepare", "confirm-exit"]);
  const stop = await installCloseCoordination(f.adapter, f.coordinator, () => {});
  expect(f.handlers().close).toBeDefined(); expect(f.handlers().exit).toBeDefined();
  stop();
  expect(f.handlers().close).toBeUndefined(); expect(f.handlers().exit).toBeUndefined();
});
