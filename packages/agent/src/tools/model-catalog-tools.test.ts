import { expect, test } from "bun:test";
import { buildModelCatalogTools } from "./model-catalog-tools";
import { createInMemoryDeps } from "../testing/fixtures";

test("model catalog tools forward discovery and explicit refresh through shared settings ports", async () => {
  const { deps } = createInMemoryDeps();
  const calls: unknown[] = [];
  const query = deps.settings.getModelCatalog;
  deps.settings.getModelCatalog = async input => { calls.push(input); return query(input); };
  deps.settings.refreshModelCatalog = async (provider, signal) => { calls.push([provider, signal]); return query({ provider }); };
  const [read, refresh] = buildModelCatalogTools(deps);
  const abort = new AbortController();
  await read!.execute("read", { provider: "openai", search: "reason", limit: 5 }, abort.signal);
  expect(calls[0]).toEqual({ provider: "openai", search: "reason", limit: 5 });
  await refresh!.execute("refresh", { provider: "openai" }, abort.signal);
  expect(calls[1]).toEqual(["openai", abort.signal]); expect(refresh!.executionMode).toBe("sequential");
  abort.abort(); await expect(refresh!.execute("cancel", { provider: "openai" }, abort.signal)).rejects.toThrow();
  expect(calls).toHaveLength(2);
  deps.settings.refreshModelCatalog = async () => { throw Error("host rejected"); };
  await expect(refresh!.execute("failed", { provider: "openai" })).rejects.toThrow("host rejected");
});
