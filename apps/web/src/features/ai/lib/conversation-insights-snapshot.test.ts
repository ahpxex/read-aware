import { expect, spyOn, test } from "bun:test";
import * as localStore from "../../../platform/local-store";
import * as ipc from "../../../platform/ipc";
import { loadConversationInsightsSnapshot, prepareConversationInsightsSnapshot } from "./conversation-insights-store";
import { deferred } from "../../../../tests/helpers/profile-host";
import golden from "../../../../../../packages/core/src/context-bundle-insights.golden.json";
import type { ConversationInsightsSnapshot, ConversationTarget } from "@read-aware/core";

test("source preparation settles the owner queue before the durability barrier and propagates barrier failure", async () => {
  const gate = deferred(), calls: string[] = [];
  const after = spyOn(localStore, "afterLocalKVWrites").mockImplementation(async operation => {
    calls.push("wait-owner"); await gate.promise; return operation();
  });
  const flush = spyOn(localStore, "flushLocalKV").mockImplementation(async prefix => {
    expect(prefix).toBe("read-aware-agent-insights"); calls.push("flush");
  });
  try {
    const pending = prepareConversationInsightsSnapshot();
    expect(calls).toEqual(["wait-owner"]); gate.resolve(); await pending;
    expect(calls).toEqual(["wait-owner", "flush"]);
    const failure = Error("durability failed"); flush.mockRejectedValue(failure);
    await expect(prepareConversationInsightsSnapshot()).rejects.toBe(failure);
  } finally { after.mockRestore(); flush.mockRestore(); }
});

test("snapshot reads only the fixed native operation, freezes its target and never consumes the optimistic mirror", async () => {
  const read = spyOn(localStore.localKV, "getItem").mockImplementation(() => { throw Error("optimistic mirror must not be read"); });
  const native = spyOn(ipc, "invoke").mockResolvedValue(golden);
  try {
    const target: ConversationTarget = { kind: "book", id: "book:one" };
    const pending = loadConversationInsightsSnapshot(target); target.id = "changed";
    expect(await pending).toEqual(golden as ConversationInsightsSnapshot);
    expect(native).toHaveBeenCalledWith("conversation_insights_snapshot", { target: golden.target });
    expect(read).not.toHaveBeenCalled();
    await expect(loadConversationInsightsSnapshot({ kind: "global", id: "book:one" })).rejects.toMatchObject({ code: "ui/invalid-target" });
    expect(native).toHaveBeenCalledTimes(1);
    native.mockRejectedValue(Error("native failure"));
    await expect(loadConversationInsightsSnapshot({ kind: "book", id: "book:one" })).rejects.toThrow("native failure");
  } finally { read.mockRestore(); native.mockRestore(); }
});
