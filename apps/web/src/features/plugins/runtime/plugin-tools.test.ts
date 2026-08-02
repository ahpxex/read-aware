import { afterEach, describe, expect, test } from "bun:test";
import type { Id } from "@read-aware/core";
import type { PluginDisposable } from "@read-aware/plugin-types";
import { registerToolContribution } from "../state/plugin-store";
import { getPluginAgentTools } from "./plugin-tools";

const disposables: PluginDisposable[] = [];

function register(name: string, contexts?: Array<"book" | "global">): void {
  disposables.push(
    registerToolContribution({
      key: `plugin:${name}`,
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
  });
});
