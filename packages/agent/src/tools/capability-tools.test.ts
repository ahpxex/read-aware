import { expect, test } from "bun:test";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { HOST_CAPABILITY_CATALOG } from "@read-aware/core";
import type { ThreadScope } from "../thread-scope";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildAgentTools } from "./registry";
import { buildCapabilityTool } from "./capability-tools";

type Entry = { name?: string; source?: string; family?: string; id?: string; version?: string; pluginPermissions?: string[]; textTruncated?: boolean };
type Page = { revision: string; items: Entry[]; total: number; nextOffset: number | null; semantics: string; scope: string };
const scopes: ThreadScope[] = [{ kind: "book", bookId: "book" }, { kind: "global", threadId: "thread" }];
function parse(result: Awaited<ReturnType<AgentTool["execute"]>>): Page {
  const content = result.content[0];
  if (content?.type !== "text") throw new Error("Expected text");
  expect(content.text.length).toBeLessThan(16_000);
  return JSON.parse(content.text);
}
const extension = (name: string, description = "Extension metadata"): AgentTool => ({
  name, description, label: "Extension", parameters: Type.Object({}), execute: async () => { throw new Error("Discovery must not execute tools"); },
});

test("scope catalogs exactly match registered tools, include extensions and survive per-request rebuilds", async () => {
  for (const scope of scopes) {
    const { deps } = createInMemoryDeps(); let builds = 0;
    deps.extraTools = received => { expect(received).toBe(scope); builds++; return [extension(`plugin_${scope.kind}_lookup`)]; };
    const all: Entry[] = [];
    let offset: number | null = 0, revision: string | undefined;
    while (offset !== null) {
      const registered = buildAgentTools(scope, deps);
      const before = builds;
      const tool = registered.find(tool => tool.name === "get_host_capabilities")!;
      const page = parse(await tool.execute("catalog", { catalog: "tools", offset, revision }));
      expect(builds).toBe(before);
      expect(page.scope).toBe(scope.kind);
      expect(page.semantics).toContain("not-live-readiness");
      if (revision) expect(page.revision).toBe(revision);
      revision = page.revision; offset = page.nextOffset; all.push(...page.items);
      if (offset === null) expect(all.map(entry => entry.name).sort()).toEqual(registered.map(tool => tool.name).sort());
    }
    expect(all.find(entry => entry.name === `plugin_${scope.kind}_lookup`)?.source).toBe("extension");
    expect(all.find(entry => entry.name === "get_host_capabilities")?.source).toBe("host");
    expect(all.some(entry => entry.name === "list_books")).toBe(scope.kind === "global");
  }
});

test("host catalog uses all canonical families and versions without claiming Agent callability or grants", async () => {
  const tool = buildCapabilityTool(scopes[0], [], []), all: Entry[] = [];
  let offset: number | null = 0, revision: string | undefined;
  while (offset !== null) {
    const page = parse(await tool.execute("host", { offset, revision, limit: 20 }));
    expect(page.semantics).toContain("not-agent-callability");
    expect(page.semantics).toContain("not-grants");
    all.push(...page.items); offset = page.nextOffset; revision = page.revision;
  }
  expect(all.map(entry => `${entry.family}.${entry.id}@${entry.version}`).sort()).toEqual(
    Object.entries(HOST_CAPABILITY_CATALOG).flatMap(([family, entries]) => Object.entries(entries).map(([id, entry]) => `${family}.${id}@${entry.version}`)).sort(),
  );
  expect(all.find(entry => entry.family === "domains" && entry.id === "library")?.pluginPermissions).toEqual(["library:read", "library:write"]);
  expect(all.find(entry => entry.family === "schemas" && entry.id === "views")?.pluginPermissions).toEqual([]);
  const page = parse(await tool.execute("filtered", { family: "schemas", query: "views" }));
  expect(page.items).toHaveLength(1); expect(page.items[0].id).toBe("views");
  expect(parse(await tool.execute("camel-case", { query: "VOICEPROVIDERS" })).items[0].id).toBe("voiceProviders");
});

test("changed request scope, metadata or query rejects continuation rather than skipping entries", async () => {
  const first = buildCapabilityTool(scopes[0], [], [extension("plugin_one")]);
  const page = parse(await first.execute("first", { catalog: "tools", limit: 1 }));
  const next = { catalog: "tools", offset: page.nextOffset, revision: page.revision };
  await expect(buildCapabilityTool(scopes[1], [], [extension("plugin_one")]).execute("scope", next)).rejects.toMatchObject({ code: "ai/capability-catalog-changed" });
  await expect(buildCapabilityTool(scopes[0], [], []).execute("retired", next)).rejects.toMatchObject({ code: "ai/capability-catalog-changed" });
  await expect(buildCapabilityTool(scopes[0], [], [extension("plugin_one", "Changed")]).execute("metadata", next)).rejects.toMatchObject({ code: "ai/capability-catalog-changed" });
  await expect(first.execute("filter", { ...next, query: "one" })).rejects.toMatchObject({ code: "ai/capability-catalog-changed" });
  expect(parse(await first.execute("none", { catalog: "tools", query: "absent_name" })).items).toEqual([]);
});

test("discovery validates its own boundary and honors cancellation", async () => {
  const tool = buildCapabilityTool(scopes[0], [], []);
  for (const input of [null, [], { catalog: "private" }, { catalog: "tools", family: "schemas" }, { offset: 1 },
    { offset: -1 }, { limit: 0 }, { limit: 21 }, { limit: 1.5 }, { query: "x".repeat(121) }, { revision: "old" }, { bookId: "other" }]) {
    await expect(tool.execute("invalid", input)).rejects.toMatchObject({ code: "ai/invalid-capability-query" });
  }
  const owner = new AbortController(); owner.abort(new Error("cancelled"));
  await expect(tool.execute("cancelled", {}, owner.signal)).rejects.toThrow("cancelled");
});

test("escaped extension metadata is paged by actual JSON size and oversized entries fail explicitly", async () => {
  const extensions = Array.from({ length: 20 }, (_, index) => extension(`plugin_${index}`, "\u0000".repeat(1000)));
  const tool = buildCapabilityTool(scopes[0], [], extensions);
  let offset: number | null = 0, revision: string | undefined;
  const all: Entry[] = [];
  while (offset !== null) {
    const page = parse(await tool.execute("page", { catalog: "tools", query: "plugin_", limit: 20, offset, revision }));
    expect(page.items.length).toBeGreaterThan(0); expect(page.items.length).toBeLessThan(20);
    expect(page.items.every(entry => entry.textTruncated)).toBe(true);
    all.push(...page.items); offset = page.nextOffset; revision = page.revision;
  }
  expect(all.map(entry => entry.name).sort()).toEqual(extensions.map(tool => tool.name).sort());
  const oversized = buildCapabilityTool(scopes[0], [], [extension("z".repeat(13_000))]);
  const first = parse(await oversized.execute("first", { catalog: "tools" }));
  await expect(oversized.execute("oversized", { catalog: "tools", offset: first.nextOffset, revision: first.revision })).rejects.toMatchObject({ code: "ai/capability-catalog-unavailable" });
});
