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
});

describe("plugin agent providers", () => {
  afterEach(() => {
    while (disposables.length > 0) disposables.pop()?.dispose();
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
      { scope: "book:book-1", kind: "insight", content: "remember this link" },
    ]);
  });
});
