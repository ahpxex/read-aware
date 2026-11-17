import { expect, test } from "bun:test";
import { PendingIntentSlot } from "./pending-intent";

function slot(deadlineMs = 20) {
  const expired: string[] = [];
  const pending = new PendingIntentSlot<string, number>({
    deadlineMs,
    timeout: () => new Error("timeout"),
    superseded: () => new Error("superseded"),
    onExpire: (intent) => expired.push(intent.payload),
  });
  return { pending, expired };
}

test("a newer intent supersedes the outstanding one, which never reconciles", async () => {
  const { pending, expired } = slot();
  const first = pending.begin("a");
  const second = pending.begin("b");
  await expect(first.settled).rejects.toThrow("superseded");
  expect(first.intent.signal.aborted).toBe(true);
  expect(pending.holds(first.intent)).toBe(false);
  pending.confirm(first.intent, 1);
  pending.confirm(second.intent, 2);
  expect(await second.settled).toBe(2);
  pending.confirm(second.intent, 3);
  expect(expired).toEqual([]);
});

test("a timeout or the caller's abort ends the intent unconfirmed and lets the owner reconcile", async () => {
  const { pending, expired } = slot();
  await expect(pending.begin("late").settled).rejects.toThrow("timeout");
  const controller = new AbortController();
  const aborted = pending.begin("aborted", controller.signal);
  controller.abort(new Error("caller"));
  await expect(aborted.settled).rejects.toThrow("caller");
  expect(expired).toEqual(["late", "aborted"]);
  const already = new AbortController();
  already.abort(new Error("before"));
  await expect(pending.begin("never", already.signal).settled).rejects.toThrow("before");
  expect(pending.current).toBeUndefined();
});

test("a confirmed intent clears its deadline", async () => {
  const { pending, expired } = slot(5);
  const { intent, settled } = pending.begin("done");
  pending.confirm(intent, 7);
  expect(await settled).toBe(7);
  await new Promise((resolve) => setTimeout(resolve, 15));
  expect(expired).toEqual([]);
});
