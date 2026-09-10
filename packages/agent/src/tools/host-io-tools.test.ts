import { expect, test } from "bun:test";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildHostIOTools } from "./host-io-tools";

test("Agent IO shares bounded host effects, preserves cancelled export and returns no payload echoes", async () => {
  const { deps } = createInMemoryDeps(), calls: unknown[] = [], signal = new AbortController().signal;
  deps.hostIO.writeClipboard = async (...args) => { calls.push(args); };
  deps.hostIO.openExternal = async (...args) => { calls.push(args); };
  deps.hostIO.exportFile = async (...args) => { calls.push(args); return false; };
  const tools = buildHostIOTools(deps), call = (name: string, params: unknown) => tools.find(tool => tool.name === name)!.execute("test", params, signal);
  expect(JSON.stringify(await call("copy_to_clipboard", { text: "PRIVATE CONTENT" }))).not.toContain("PRIVATE CONTENT");
  expect(JSON.stringify(await call("export_text_file", { filename: "notes.txt", content: "private" }))).toContain('\\"saved\\":false');
  await call("open_external_url", { url: "https://example.com/" });
  expect(calls).toEqual([["PRIVATE CONTENT", signal], [{ filename: "notes.txt", content: "private" }, signal], ["https://example.com/", signal]]);
  await expect(call("open_external_url", { url: "file:///tmp/private" })).rejects.toMatchObject({ code: "ui/invalid-target" });
  await expect(call("list_installed_plugins", { limit: 101 })).rejects.toMatchObject({ code: "ui/invalid-target" });
  expect(calls).toHaveLength(3);
  deps.hostIO.writeClipboard = async () => { throw Error("write failed"); };
  await expect(call("copy_to_clipboard", { text: "no success" })).rejects.toThrow("write failed");
});

test("Agent contribution discovery forwards validated filters and stops on cancellation", async () => {
  const { deps } = createInMemoryDeps();
  const queries: unknown[] = [];
  deps.hostIO.listPluginContributions = async query => {
    queries.push(query);
    return { contributions: [{ point: "contentProviders", pluginId: "feeds", key: "feeds:articles" }], total: 1, offset: 0, nextOffset: null };
  };
  const tool = buildHostIOTools(deps).find(tool => tool.name === "list_plugin_contributions")!;
  expect(JSON.stringify(await tool.execute("test", { point: "contentProviders", pluginId: "feeds", limit: 3 }))).toContain("feeds:articles");
  expect(queries).toEqual([{ point: "contentProviders", pluginId: "feeds", limit: 3, offset: 0, search: "" }]);
  await expect(tool.execute("invalid", { point: "__proto__" })).rejects.toMatchObject({ code: "ui/invalid-target" });
  await expect(tool.execute("cancelled", {}, AbortSignal.abort(Error("stopped")))).rejects.toThrow("stopped");
  expect(queries).toHaveLength(1);
});
