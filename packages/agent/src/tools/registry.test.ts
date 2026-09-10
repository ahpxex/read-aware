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

    expect(tools).toHaveLength(72);
    expect(tools).toContain("reset_reading_settings");
    expect(tools).toContain("list_book_formats");
    expect(tools).not.toContain("inspect_resource_book");
    expect(tools).toContain("get_book_enrichment");
    expect(tools).toContain("retry_book_enrichment");
    expect(tools).toContain("open_book_cover");
    expect(tools).toContain("copy_resource_image");
    expect(tools).toContain("open_book_resource");
    expect(tools).toContain("pick_resource_files");
    expect(tools).not.toContain("import_resource_book");
    expect(tools).not.toContain("merge_duplicate_books");
    expect(tools).toContain("get_software_update");
    expect(tools).toContain("open_maintenance_settings");
    expect(tools).toContain("get_sync_status");
    expect(tools).toContain("manage_sync");
    expect(tools).toContain("request_conversation_turn");
    expect(tools).toContain("get_conversation_state");
    expect(tools).not.toContain("manage_conversation");
    expect(tools).toContain("list_installed_plugins");
    expect(tools).toContain("copy_to_clipboard");
    expect(tools).toContain("export_text_file");
    expect(tools).toContain("open_external_url");
    expect(tools).toContain("manage_reading_emphasis");
    expect(tools).toContain("set_reading_selection");
    expect(tools).toContain("manage_book_graph");
    expect(tools).toContain("classify_book");
    expect(tools).toContain("manage_memory");
    expect(tools).toContain("list_host_commands");
    expect(tools).toContain("execute_host_command");
    expect(tools).toContain("get_workspace");
    expect(tools).toContain("navigate_app");
    expect(tools).toContain("get_book_text_status");
    expect(tools).toContain("get_reader_panels");
    expect(tools).toContain("set_reader_panel");
    expect(tools).toContain("set_reader_controls");
    expect(tools).toContain("get_host_environment");
    expect(tools).toContain("configure_reading_mode");
    expect(tools).toContain("control_read_aloud");
    expect(tools).toContain("apply_annotation_changes");
    expect(tools).toContain("get_navigation_toc");
    expect(tools).toContain("find_book_locations");
    expect(tools).toContain("get_reading_session");
    expect(tools).toContain("navigate_reading");
    expect(tools).toContain("read_chapter");
    expect(tools).toContain("query_book_graph");
    expect(tools).toContain("create_annotation");
    expect(tools).toContain("update_book");
    expect(tools).toContain("delete_book");
    expect(tools).toContain("update_settings");
    expect(tools).not.toContain("list_books");
    expect(tools).not.toContain("list_collections");
    expect(tools).not.toContain("manage_collection");
    expect(tools).not.toContain("delete_collection");
    expect(tools).not.toContain("delete_books");
    expect(tools).not.toContain("list_book_removal_cleanup");
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

    expect(tools).toHaveLength(89);
    expect(tools).toContain("inspect_resource_book");
    expect(tools).toContain("merge_duplicate_books");
    expect(tools).toContain("import_resource_book");
    expect(tools).toContain("list_plugin_schedules");
    expect(tools).toContain("manage_plugin_schedule");
    expect(tools).toContain("request_conversation_turn");
    expect(tools).toContain("manage_reading_emphasis");
    expect(tools).toContain("set_reading_selection");
    expect(tools).toContain("manage_book_graph");
    expect(tools).toContain("classify_book");
    expect(tools).toContain("manage_memory");
    expect(tools).toContain("list_host_commands");
    expect(tools).toContain("execute_host_command");
    expect(tools).toContain("get_workspace");
    expect(tools).toContain("navigate_app");
    expect(tools).toContain("list_book_removal_cleanup");
    expect(tools).toContain("delete_books");
    expect(tools).toContain("get_book_text_status");
    expect(tools).toContain("get_reader_panels");
    expect(tools).toContain("set_reader_panel");
    expect(tools).toContain("set_reader_controls");
    expect(tools).toContain("get_host_environment");
    expect(tools).toContain("configure_reading_mode");
    expect(tools).toContain("control_read_aloud");
    expect(tools).toContain("apply_annotation_changes");
    expect(tools).toContain("get_navigation_toc");
    expect(tools).toContain("find_book_locations");
    expect(tools).toContain("get_reading_session");
    expect(tools).toContain("navigate_reading");
    expect(tools).toContain("list_books");
    expect(tools).toContain("manage_collection");
    expect(tools).toContain("get_conversation_insights");
    expect(tools).toContain("present_books");
    expect(seen).toEqual([global]);
  });

  test("global book overview requires the id that list_books resolved", () => {
    const { deps } = createInMemoryDeps();
    const tool = buildAgentTools(
      { kind: "global", threadId: "t1" },
      deps,
    ).find((candidate) => candidate.name === "get_book_overview");

    expect((tool?.parameters as { required?: string[] }).required).toEqual(["bookId"]);
  });
});
