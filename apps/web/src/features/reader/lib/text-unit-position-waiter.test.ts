import { expect, test } from "bun:test";
import { TextUnitPositionWaiter } from "./text-unit-position-waiter";

test("position waits observe actual transitions and release on completion, failure and cancellation", async () => {
  const waiter = new TextUnitPositionWaiter();
  const abort = new AbortController();
  let value: string | undefined;
  let calls = 0;
  const inspect = () => { calls++; return value; };
  const work = waiter.wait(inspect, abort.signal);
  waiter.notify(); expect(calls).toBe(2);
  value = "restored"; waiter.notify(); expect(await work).toBe("restored");
  waiter.notify(); expect(calls).toBe(3);
  value = undefined;
  const cancelled = waiter.wait(inspect, abort.signal).catch(error => error);
  abort.abort(new Error("cancelled"));
  expect((await cancelled).message).toBe("cancelled");
  const previous = calls; waiter.notify(); expect(calls).toBe(previous);
  await expect(waiter.wait(() => { throw new Error("invalid CFI"); }, new AbortController().signal)).rejects.toThrow("invalid CFI");
});
