import { afterEach, describe, expect, test } from "bun:test";
import type { Id } from "@read-aware/core";
import type { PluginDisposable } from "@read-aware/plugin-types";
import {
  registerAgentContextProviderContribution,
  registerAgentRetrievalProviderContribution,
  registerMemoryCandidateProviderContribution,
  registerToolContribution,
} from "../state/plugin-store";
import { inspectContributions } from "../state/contribution-registry";
import { assertToolApproval } from "../lib/plugin-tool-approval";
import {
  getPluginAgentContext,
  getPluginAgentTools,
  getPluginMemoryCandidates,
} from "./plugin-tools";

const disposables: PluginDisposable[] = [];

function register(name: string, contexts?: Array<"book" | "global">): void {
  disposables.push(
    registerToolContribution({
      key: `scope-test:${name}`,
      pluginId: "scope-test",
      pluginName: "Scope Test",
      name,
      description: `${name} description`,
      contexts,
      execute: () => null,
    }),
  );
}

describe("plugin agent tool scopes", () => {
  afterEach(() => {
    while (disposables.length > 0) disposables.pop()?.dispose();
  });

  test("disabled tools disappear from both scopes and previously built tools recheck the exact registration", async () => {
    let calls = 0;
    const definition = { key: "state-test:tool", pluginId: "state-test", pluginName: "State Test",
      name: "tool", description: "Tool", execute: () => ++calls };
    const registration = registerToolContribution(definition);
    disposables.push(registration);
    const book = { kind: "book" as const, bookId: "book" as Id };
    const global = { kind: "global" as const, threadId: "thread" };
    const cached = getPluginAgentTools(book).find(tool => tool.name === "plugin_state_test_tool")!;
    await cached.execute("one", {});
    await registration.updateState({ revision: 1, enabled: false, visible: true });
    for (const scope of [book, global]) expect(getPluginAgentTools(scope).some(tool => tool.name === cached.name)).toBe(false);
    await expect(cached.execute("two", {})).rejects.toMatchObject({ code: "plugin/action-disabled" });
    await registration.updateState({ revision: 2, enabled: true, visible: false });
    await expect(cached.execute("hidden", {})).rejects.toMatchObject({ code: "plugin/action-disabled" });
    await registration.updateState({ revision: 3, enabled: true, visible: true });
    await cached.execute("three", {});
    expect(calls).toBe(2);
    disposables.push(registerToolContribution(definition));
    await expect(cached.execute("old", {})).rejects.toMatchObject({ code: "plugin/unavailable" });
    expect(await registration.updateState({ revision: 100, enabled: false, visible: false })).toEqual({ status: "inactive" });
    const current = getPluginAgentTools(global).find(tool => tool.name === cached.name)!;
    await current.execute("replacement", {});
    expect(calls).toBe(3);
  });

  test("filters declared contexts and keeps omitted contexts backward compatible", () => {
    register("book_only", ["book"]);
    register("global_only", ["global"]);
    register("legacy_both");

    const book = getPluginAgentTools({ kind: "book", bookId: "book-1" as Id }).map(
      (tool) => tool.name,
    );
    const global = getPluginAgentTools({ kind: "global", threadId: "thread-1" }).map(
      (tool) => tool.name,
    );

    expect(book).toEqual([
      "plugin_scope_test_book_only",
      "plugin_scope_test_legacy_both",
    ]);
    expect(global).toEqual([
      "plugin_scope_test_global_only",
      "plugin_scope_test_legacy_both",
    ]);
    expect(inspectContributions("scope-test")).toEqual([
      {
        point: "agentTools",
        key: "scope-test:book_only",
        pluginId: "scope-test",
      },
      {
        point: "agentTools",
        key: "scope-test:global_only",
        pluginId: "scope-test",
      },
      {
        point: "agentTools",
        key: "scope-test:legacy_both",
        pluginId: "scope-test",
      },
    ]);
  });

  test("confirmation snapshots arguments, requires host approval and preserves interaction details", async () => {
    const calls: unknown[] = [], updates: unknown[] = [];
    const registration = registerToolContribution({ key: "approval:remove", pluginId: "approval", pluginName: "Approval Test",
      name: "remove", label: "Remove item", description: "Remove one item", approval: "required", execute: params => { calls.push(params); return { removed: true }; } });
    disposables.push(registration);
    const scope = { kind: "global" as const, threadId: "approval-thread" };
    let answer = "decline";
    const params = { id: "original", nested: { value: 1 } };
    const tool = getPluginAgentTools(scope, { request: async request => {
      expect(request.kind).toBe("permission");
      if (request.kind === "permission") {
        expect(request.action).toBe("plugin-tool");
        expect(request.subject).toContain("Approval Test (approval)");
        expect(request.subject).toContain('"original"');
      }
      expect(calls).toHaveLength(0);
      params.id = "changed"; params.nested.value = 99;
      return { optionId: answer };
    } }).find(item => item.name === "plugin_approval_remove")!;
    expect(tool.executionMode).toBe("sequential");
    const declined = await tool.execute("declined", params, undefined, update => { updates.push(update); });
    expect(calls).toHaveLength(0); expect(declined.details).toMatchObject({ type: "user-interaction", phase: "response" });
    params.id = "original"; params.nested.value = 1; answer = "approve";
    const approved = await tool.execute("approved", params, undefined, update => { updates.push(update); });
    expect(calls).toEqual([{ id: "original", nested: { value: 1 } }]);
    expect(approved.details).toMatchObject({ type: "user-interaction", phase: "response", answer: { optionId: "approve" } });
    expect(updates).toHaveLength(4);
  });

  test("missing confirmation port, oversized input and retired or cancelled approvals never execute", async () => {
    let calls = 0, prompts = 0;
    const definition = { key: "approval:guarded", pluginId: "approval", pluginName: "Approval",
      name: "guarded", description: "Remove", approval: "required" as const, execute: () => ++calls };
    const registration = registerToolContribution(definition); disposables.push(registration);
    const scope = { kind: "global" as const, threadId: "guarded-thread" };
    const noPort = getPluginAgentTools(scope).find(tool => tool.name === "plugin_approval_guarded")!;
    await expect(noPort.execute("missing", {})).rejects.toMatchObject({ code: "ui/unavailable" });
    const tool = getPluginAgentTools(scope, { request: async () => { prompts++; await registration.updateState({ revision: 1, enabled: false, visible: true }); return { optionId: "approve" }; } }).find(tool => tool.name === noPort.name)!;
    await expect(tool.execute("large", { text: "x".repeat(16_384) })).rejects.toMatchObject({ code: "plugin/payload-too-large" });
    await expect(tool.execute("invalid", { value: NaN })).rejects.toMatchObject({ code: "plugin/invalid-input" });
    expect(prompts).toBe(0);
    await expect(tool.execute("disabled", {})).rejects.toMatchObject({ code: "plugin/action-disabled" });
    expect(calls).toBe(0);
    disposables.push(registerToolContribution(definition));
    const controller = new AbortController();
    const current = getPluginAgentTools(scope, { request: async () => { controller.abort(new Error("Turn stopped")); return { optionId: "approve" }; } }).find(item => item.name === noPort.name)!;
    await expect(current.execute("cancelled", {}, controller.signal)).rejects.toThrow("Turn stopped");
    await expect(tool.execute("replaced", {})).rejects.toMatchObject({ code: "plugin/unavailable" });
    expect(calls).toBe(0);
  });

  test("approval cannot be silently accepted by pre-1.2 capability ranges", () => {
    expect(() => assertToolApproval(undefined)).not.toThrow();
    expect(() => assertToolApproval("required", "^1.2.0")).not.toThrow();
    for (const range of [undefined, "*", "^1.0.0", ">=1.1.0", "^1.1.0 || ^2.0.0"]) {
      expect(() => assertToolApproval("required", range)).toThrow();
    }
    expect(() => assertToolApproval(false, "^1.2.0")).toThrow();
  });
});

describe("plugin agent providers", () => {
  afterEach(() => {
    while (disposables.length > 0) disposables.pop()?.dispose();
  });

  test("cached retrieval tools cannot execute disposed or same-ID replacement providers", async () => {
    let calls = 0;
    const definition = { key: "retrieval-state:search", pluginId: "retrieval-state", pluginName: "Retrieval State",
      id: "search", label: "Search", description: "Search", retrieve: () => { calls++; return []; } };
    const registration = registerAgentRetrievalProviderContribution(definition);
    disposables.push(registration);
    const scope = { kind: "global" as const, threadId: "thread" };
    const name = "plugin_retrieval_state_retrieve_search";
    const original = getPluginAgentTools(scope).find(tool => tool.name === name)!;
    await original.execute("one", { query: "query" });
    // A replacement is a new registration even when its public key is identical.
    const replacement = registerAgentRetrievalProviderContribution(definition);
    disposables.push(replacement);
    await expect(original.execute("retired", { query: "query" })).rejects.toMatchObject({ code: "plugin/unavailable" });
    const current = getPluginAgentTools(scope).find(tool => tool.name === name)!;
    await current.execute("two", { query: "query" });
    registration.dispose();
    expect(getPluginAgentTools(scope).some(tool => tool.name === name)).toBe(true);
    replacement.dispose();
    expect(getPluginAgentTools(scope).some(tool => tool.name === name)).toBe(false);
    await expect(current.execute("disposed", { query: "query" })).rejects.toMatchObject({ code: "plugin/unavailable" });
    expect(calls).toBe(2);
  });

  test("consumes context, retrieval, and memory candidates through bounded host adapters", async () => {
    disposables.push(
      registerAgentContextProviderContribution({
        key: "extension-test:context",
        pluginId: "extension-test",
        pluginName: "Extension Test",
        id: "context",
        contexts: ["book"],
        provide: () => [{ title: "Nearby", content: "relevant plugin context" }],
      }),
      registerAgentRetrievalProviderContribution({
        key: "extension-test:search",
        pluginId: "extension-test",
        pluginName: "Extension Test",
        id: "search",
        label: "Search extension",
        description: "Search its private index",
        retrieve: ({ query, limit }) => [
          { title: query, content: "x".repeat(3_000), location: String(limit) },
        ],
      }),
      registerMemoryCandidateProviderContribution({
        key: "extension-test:memory",
        pluginId: "extension-test",
        pluginName: "Extension Test",
        id: "memory",
        propose: () => [{ scope: "book", kind: "insight", content: "remember this link" }],
      }),
    );

    const scope = { kind: "book" as const, bookId: "book-1" as Id };
    expect(await getPluginAgentContext({ scope, userText: "question" })).toEqual([
      {
        source: "Extension Test (extension-test/context)",
        title: "Nearby",
        content: "relevant plugin context",
      },
    ]);

    const retrieval = getPluginAgentTools(scope).find((tool) =>
      tool.name.includes("retrieve_search")
    );
    const result = await retrieval?.execute("call-1", { query: "needle", limit: 99 });
    const payload = JSON.parse(result?.content[0]?.type === "text" ? result.content[0].text : "{}");
    expect(payload.items[0].content).toHaveLength(2_000);
    expect(payload.items[0].location).toBe("10");

    expect(
      await getPluginMemoryCandidates({
        scope,
        userText: "question",
        assistantText: "answer",
      }),
    ).toEqual([
      expect.objectContaining({ scope: "book:book-1", kind: "insight", content: "remember this link" }),
    ]);
  });
});
