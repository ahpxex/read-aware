import { describe, expect, test } from "bun:test";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildAgentTools } from "./registry";
import { TOOL_FAMILIES } from "./tool-families";

describe("agent tool registry", () => {
  for (const scope of [
    { kind: "book", bookId: "b1" },
    { kind: "global", threadId: "t1" },
  ] as const) {
    test(`${scope.kind}: the complete catalog uses families without legacy aliases`, () => {
      const { deps } = createInMemoryDeps();
      const seen: unknown[] = [];
      deps.extraTools = (scope) => {
        seen.push(scope);
        return [];
      };
      const tools = buildAgentTools(scope, deps);
      const names = tools.map((tool) => tool.name);
      expect(names).toHaveLength(scope.kind === "book" ? 92 : 110);
      expect(new Set(names).size).toBe(names.length);
      const retired = [
        ...TOOL_FAMILIES.flatMap((f) => Object.values(f.members)),
        "edit_annotation",
        "get_navigation_toc",
      ];
      for (const name of retired) expect(names).not.toContain(name);
      for (const name of [
        "query_conversation",
        "query_reading_stats",
        "query_book_text_tasks",
        "manage_book_text_task",
        "reader_panels",
        "acquire_resource",
        "manage_resource",
        "resource_directory",
        "query_context_bundles",
        "manage_context_bundle",
        "query_book_references",
        "control_book_reference",
        "get_toc",
        "read_chapter",
        "search_book_text",
        "read_book_image",
        "get_reading_session",
        "apply_annotation_changes",
        "delete_annotation",
        "list_bookmarks",
        "save_bookmark",
        "manage_bookmark",
        "update_settings",
        "get_operation_availability",
        "get_host_capabilities",
      ])
        expect(names).toContain(name);
      for (const name of [
        "list_books",
        "list_collections",
        "manage_collection",
        "delete_collection",
        "delete_books",
        "list_book_removal_cleanup",
        "manage_conversation",
        "present_books",
        "reading_action",
        "query_book_imports",
        "manage_book_import",
      ])
        expect(names.includes(name)).toBe(scope.kind === "global");
      // A partially available family must not expose the unavailable branch.
      const acquire = JSON.stringify(tools.find((tool) => tool.name === "acquire_resource")!.parameters);
      const conversation = JSON.stringify(tools.find((tool) => tool.name === "query_conversation")!.parameters);
      expect(acquire.includes('"const":"download"')).toBe(scope.kind === "global");
      expect(conversation.includes('"const":"summary"')).toBe(scope.kind === "global");
      expect(seen).toEqual([scope]);
    });
  }

  test("global book overview requires the id that list_books resolved", () => {
    const { deps } = createInMemoryDeps();
    const tool = buildAgentTools({ kind: "global", threadId: "t1" }, deps).find((t) => t.name === "get_book_overview");
    expect((tool?.parameters as { required?: string[] } | undefined)?.required).toEqual(["bookId"]);
  });
});
