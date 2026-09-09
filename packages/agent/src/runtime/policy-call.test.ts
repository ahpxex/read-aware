import { expect, test } from "bun:test";
import { policyCall } from "./policy-call";
import { memoryPolicyState } from "../testing/memory-policy";

test("preflight revocation wins against an already fulfilled operation", async () => {
  const state = memoryPolicyState();
  state.set(false);
  const call = policyCall(state.policy, () => Error("denied"));
  await expect(call.wait(Promise.resolve("forbidden"))).rejects.toThrow("denied");
  call.dispose();
  expect(state.count()).toBe(0);
});

test("revocation after wait starts wins over fulfillment in the same tick", async () => {
  const state = memoryPolicyState();
  const call = policyCall(state.policy, () => Error("denied"));
  const result = call.wait(Promise.resolve("forbidden"));
  state.set(false); state.set(true);
  await expect(result).rejects.toThrow("denied");
  call.dispose();
});

test("an already aborted caller cannot receive an already fulfilled result", async () => {
  const controller = new AbortController();
  controller.abort(Error("cancelled"));
  const state = memoryPolicyState();
  const call = policyCall(state.policy, () => Error("denied"), controller.signal);
  await expect(call.wait(Promise.resolve("forbidden"))).rejects.toThrow("cancelled");
  call.dispose();
});
