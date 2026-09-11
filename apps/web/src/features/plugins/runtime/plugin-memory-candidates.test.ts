import { expect, test } from "bun:test";
import type { ExternalMemoryCandidateRequest } from "@read-aware/agent";
import type { MemoryCandidateReceipt } from "@read-aware/core";
import type { RegisteredMemoryCandidateProvider } from "../lib/plugin-types";
import { registerMemoryCandidateProviderContribution } from "../state/plugin-store";
import { proposePluginMemories } from "./plugin-memory-candidates";
import { decodePluginCallbacks, PluginCallbackRegistry, releasePluginCallbacks } from "./plugin-callback-wire";

const request: ExternalMemoryCandidateRequest = { scope: { kind: "global", threadId: "test" }, userText: "q", assistantText: "a" };
function provider(extra: Partial<RegisteredMemoryCandidateProvider> = {}): RegisteredMemoryCandidateProvider {
  return { key: "memory-test:candidates", pluginId: "memory-test", pluginName: "Memory Test", id: "candidates",
    propose: () => [{ scope: "user", kind: "fact", content: "own proposal" }], ...extra };
}
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

test("provider receives one correlated bounded result, never saved records or callbacks from untrusted proposals", async () => {
  let requestId = "";
  const receipts: MemoryCandidateReceipt[] = [];
  const p = provider({ propose: input => {
    requestId = input.requestId;
    expect(input.scope).toEqual(request.scope);
    return [null, { scope: "book", kind: "fact", content: "wrong scope" },
      { scope: "user", kind: "fact", content: "own", report: () => { throw Error("must not use plugin callback"); } },
      { scope: "user", kind: "fact", content: "discarded" }] as never;
  }, onResult: receipt => { receipts.push(receipt); } });
  const registration = registerMemoryCandidateProviderContribution(p);
  try {
    const candidates = await proposePluginMemories(p, request);
    expect(candidates).toHaveLength(1); expect(receipts).toHaveLength(0);
    candidates[0]!.report!({ status: "saved" });
    candidates[0]!.report!({ status: "failed", errorCode: "db/locked" });
    await tick();
    expect(receipts).toEqual([{ requestId, discarded: 1, results: [
      { index: 0, outcome: { status: "rejected", reason: "invalid" } },
      { index: 1, outcome: { status: "rejected", reason: "scope" } }, { index: 2, outcome: { status: "saved" } },
    ] }]);
    expect(requestId).not.toBe("");
  } finally { registration.dispose(); }
});

test("replacement never inherits an old registration's candidate or result callback", async () => {
  const oldResults: MemoryCandidateReceipt[] = [], newResults: MemoryCandidateReceipt[] = [];
  const p = provider({ onResult: receipt => { oldResults.push(receipt); } });
  const old = registerMemoryCandidateProviderContribution(p);
  const candidates = await proposePluginMemories(p, request);
  const replacement = registerMemoryCandidateProviderContribution(provider({ onResult: receipt => { newResults.push(receipt); } }));
  try {
    expect(candidates[0]!.available!()).toBe(false);
    candidates[0]!.report!({ status: "saved" }); await tick();
    expect(oldResults).toEqual([]); expect(newResults).toEqual([]);
  } finally { old.dispose(); replacement.dispose(); }
});

test("late proposals after cancellation receive skipped outcomes, not writable candidates", async () => {
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const receipts: MemoryCandidateReceipt[] = [], controller = new AbortController();
  const p = provider({ propose: async () => { await wait; return [{ scope: "user", kind: "fact", content: "late" }]; },
    onResult: receipt => { receipts.push(receipt); } });
  const registration = registerMemoryCandidateProviderContribution(p);
  try {
    const pending = proposePluginMemories(p, { ...request, signal: controller.signal });
    controller.abort(); release();
    expect(await pending).toEqual([]); await tick();
    expect(receipts[0]?.results).toEqual([{ index: 0, outcome: { status: "skipped", reason: "cancelled" } }]);
  } finally { registration.dispose(); }
});

test("proposal and result callbacks survive the real callback codec and keep their activation owner", async () => {
  const registry = new PluginCallbackRegistry(), owner = new AbortController(), receipts: MemoryCandidateReceipt[] = [];
  const source = provider({ onResult: receipt => { receipts.push(receipt); } });
  const remote = decodePluginCallbacks(structuredClone(registry.encode(source)),
    (handle, args) => registry.invoke(handle, structuredClone(args)),
    handles => registry.release(handles), owner.signal) as RegisteredMemoryCandidateProvider;
  const registration = registerMemoryCandidateProviderContribution(remote);
  try {
    const candidates = await proposePluginMemories(remote, request);
    candidates[0]!.report!({ status: "saved" }); await tick();
    expect(receipts[0]?.results).toEqual([{ index: 0, outcome: { status: "saved" } }]);
    owner.abort();
    expect(candidates[0]!.available!()).toBe(false);
    expect(await proposePluginMemories(remote, request)).toEqual([]);
  } finally { registration.dispose(); releasePluginCallbacks(remote); }
  expect(registry.size).toBe(0);
});
