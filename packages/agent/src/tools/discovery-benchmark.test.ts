/**
 * Discovery recall: one query must load the tools the task goes on to use.
 *
 * `discovery-cases.json` holds queries models really issued in recorded eval
 * runs, with the tools those runs then called (regenerate with
 * `bun run eval:discovery-cases`). WRITTEN_CASES covers areas the recorded runs
 * do not reach: queries from a real shelf-cleanup session and one plain request
 * per tool group, worded the way a reader's request would be.
 */
import { describe, expect, test } from "bun:test";
import type { Id } from "@read-aware/core";
import { createInMemoryDeps } from "../testing/fixtures";
import type { ThreadScope } from "../thread-scope";
import recorded from "./discovery-cases.json";
import { buildAgentTools, buildModelTools, createAgentTurnState } from "./registry";

type Case = { scope: string; query: string; expect: string[] };
type Page = {
  items: Array<{ name: string; loaded?: boolean }>;
  loadedTools: string[];
  withheld?: Array<{ name: string; reason: string }>;
};

const scopeOf = (kind: string): ThreadScope =>
  kind === "book" ? { kind: "book", bookId: "b" as Id } : { kind: "global", threadId: "benchmark" };

async function discover(scope: ThreadScope, query: string) {
  const { deps } = createInMemoryDeps();
  const state = createAgentTurnState();
  const initial = buildModelTools(scope, deps, state);
  const tool = initial.find((item) => item.name === "get_host_capabilities")!;
  const result = await tool.execute("benchmark", { catalog: "tools", query });
  const page = JSON.parse((result.content[0] as { text: string }).text) as Page;
  return {
    page,
    core: new Set(initial.map((item) => item.name)),
    catalog: new Set(buildAgentTools(scope, deps, state).map((item) => item.name)),
  };
}

const WRITTEN_CASES: Case[] = [
  // Queries from the session where a reader asked to remove books whose files were gone.
  { scope: "global", query: "delete book remove from shelf library missing file repair", expect: ["delete_books"] },
  { scope: "global", query: "book source file status missing storage", expect: ["check_book_files"] },
  { scope: "global", query: "missing file", expect: ["check_book_files"] },
  // One plain request per tool group.
  { scope: "global", query: "favorite star book", expect: ["update_book"] },
  { scope: "global", query: "mark book finished", expect: ["update_book"] },
  { scope: "global", query: "rename book title author", expect: ["update_book"] },
  { scope: "global", query: "delete several books", expect: ["delete_books"] },
  { scope: "global", query: "collection folder organize", expect: ["manage_collection", "list_collections"] },
  { scope: "global", query: "duplicate books merge", expect: ["list_duplicate_books", "preview_book_merge"] },
  { scope: "global", query: "import book file", expect: ["manage_book_import", "acquire_resource"] },
  { scope: "global", query: "book cover", expect: ["get_book_enrichment"] },
  { scope: "global", query: "reading statistics", expect: ["query_reading_stats"] },
  { scope: "global", query: "how long did I read this week", expect: ["query_reading_stats"] },
  { scope: "global", query: "export notes to file", expect: ["export_text_file"] },
  { scope: "global", query: "copy clipboard", expect: ["copy_to_clipboard"] },
  { scope: "global", query: "bookmark list", expect: ["list_bookmarks"] },
  { scope: "global", query: "forget memory", expect: ["manage_memory"] },
  { scope: "global", query: "sync now", expect: ["manage_sync", "get_sync_status"] },
  { scope: "global", query: "backup export data", expect: ["request_backup"] },
  { scope: "global", query: "check for updates", expect: ["get_software_update"] },
  { scope: "global", query: "fullscreen window", expect: ["control_app_window"] },
  { scope: "global", query: "sort shelf by author", expect: ["execute_host_command", "list_host_commands"] },
  { scope: "global", query: "open settings page", expect: ["navigate_app"] },
  { scope: "global", query: "installed plugins", expect: ["list_installed_plugins"] },
  { scope: "global", query: "clear chat history", expect: ["manage_conversation"] },
  { scope: "global", query: "book images figures", expect: ["list_book_images"] },
  { scope: "global", query: "footnote", expect: ["query_book_references"] },
  { scope: "global", query: "knowledge graph characters", expect: ["manage_book_graph"] },
  { scope: "global", query: "prepare book text extraction", expect: ["manage_book_text_task", "get_book_text_status"] },
  { scope: "book", query: "read aloud tts", expect: ["control_read_aloud"] },
  { scope: "book", query: "next page", expect: ["navigate_reading"] },
  { scope: "book", query: "delete this book", expect: ["delete_book"] },
  { scope: "book", query: "edit note", expect: ["apply_annotation_changes"] },
  { scope: "book", query: "highlight passage", expect: ["find_book_locations"] },
  { scope: "book", query: "reading time", expect: ["query_reading_stats"] },
  { scope: "book", query: "sidebar panel", expect: ["reader_panels"] },
];

describe("one discovery loads what the task needs", () => {
  for (const item of [...(recorded as Case[]), ...WRITTEN_CASES]) {
    test(`${item.scope}: ${item.query}`, async () => {
      const { page, core, catalog } = await discover(scopeOf(item.scope), item.query);
      // A recorded expectation may since have joined the core set or belong to a plugin the fixture lacks.
      const needed = item.expect.filter((name) => catalog.has(name) && !core.has(name));
      expect(page.loadedTools).toEqual(expect.arrayContaining(needed));
      expect(page.loadedTools.length).toBeLessThanOrEqual(10);
    });
  }
});

describe("a search for something this conversation cannot do ends with an answer", () => {
  test("a book conversation names shelf-wide tools as global-only", async () => {
    for (const query of ["shelf list books library", "shelf library list books"]) {
      const { page } = await discover(scopeOf("book"), query);
      expect(page.withheld).toContainEqual(
        expect.objectContaining({ name: "list_books", reason: "only-in-the-global-assistant" }),
      );
    }
  });

  test("unconfigured web search is reported with its reason", async () => {
    for (const kind of ["global", "book"]) {
      const { page } = await discover(scopeOf(kind), "web search");
      expect(page.loadedTools).not.toContain("web_search");
      expect(page.withheld?.find((entry) => entry.name === "web_search")?.reason).toContain("search-not-configured");
    }
  });

  test("an exact name that is withheld says so", async () => {
    const { page } = await discover(scopeOf("book"), "list_books");
    expect(page.items).toEqual([]);
    expect(page.withheld).toEqual([expect.objectContaining({ name: "list_books" })]);
  });

  test("words no tool uses return nothing", async () => {
    const { page } = await discover(scopeOf("global"), "zebra quantum");
    expect(page.items).toEqual([]);
    expect(page.withheld).toBeUndefined();
  });
});
