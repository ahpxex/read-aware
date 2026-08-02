import { describe, expect, test } from "bun:test";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Id } from "@read-aware/core";
import { createInMemoryDeps } from "../testing/fixtures";
import type { ThreadScope } from "../thread-scope";
import { buildAgentTools } from "./registry";

const names = (tools: AgentTool[]) => tools.map((tool) => tool.name);

describe("agent tool registry", () => {
  test("book scope keeps reading and current-book actions, not global administration", () => {
    const { deps } = createInMemoryDeps();
    const book: ThreadScope = { kind: "book", bookId: "b1" as Id };

    const tools = names(buildAgentTools(book, deps));

    expect(tools).toHaveLength(23);
    expect(tools).toContain("read_chapter");
    expect(tools).toContain("create_note");
    expect(tools).toContain("delete_book");
    expect(tools).toContain("update_settings");
    expect(tools).not.toContain("list_books");
    expect(tools).not.toContain("list_collections");
    expect(tools).not.toContain("create_collection");
    expect(tools).not.toContain("delete_collection");
    expect(tools).not.toContain("get_conversation_insights");
    expect(tools).not.toContain("present_books");
  });

  test("global scope keeps shelf-wide tools and asks the host for scoped plugin tools", () => {
    const { deps } = createInMemoryDeps();
    const seen: ThreadScope[] = [];
    deps.extraTools = (scope) => {
      seen.push(scope);
      return [];
    };
    const global: ThreadScope = { kind: "global", threadId: "t1" };

    const tools = names(buildAgentTools(global, deps));

    expect(tools).toHaveLength(31);
    expect(tools).toContain("list_books");
    expect(tools).toContain("create_collection");
    expect(tools).toContain("get_conversation_insights");
    expect(tools).toContain("present_books");
    expect(seen).toEqual([global]);
  });
});
