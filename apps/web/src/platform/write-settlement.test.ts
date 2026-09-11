import { expect, test } from "bun:test";
import { WriteSettlement } from "./write-settlement";

test("settlement waits for every dispatched write, including ones dispatched meanwhile, without changing outcomes", async () => {
  const writes = new WriteSettlement(), first = Promise.withResolvers<number>(), second = Promise.withResolvers<void>();
  const tracked = writes.track(first.promise);
  expect(writes.size).toBe(1);
  let settled = false;
  const settling = writes.settle().then(() => { settled = true; });
  await Bun.sleep(0); expect(settled).toBe(false);
  writes.track(second.promise);
  first.resolve(7); await Bun.sleep(0); expect(settled).toBe(false);
  second.reject(new Error("write failed")); await settling;
  expect(settled).toBe(true); expect(await tracked).toBe(7); expect(writes.size).toBe(0);
  const failing = writes.track(Promise.reject(new Error("still rejects")));
  await expect(failing).rejects.toMatchObject({ message: "still rejects" });
  await writes.settle();
  const controller = new AbortController(); controller.abort(new Error("caller gone"));
  writes.track(new Promise(() => {}));
  await expect(writes.settle(controller.signal)).rejects.toMatchObject({ message: "caller gone" });
});
