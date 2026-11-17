import { expect, test } from "bun:test";
import type { Id } from "@read-aware/core";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildAgentTools } from "./registry";
import { TOOL_DISCOVERY_HINTS } from "./tool-discovery-hints";
import { schemaWording, searchTools, tokenize, wordForms, type ToolSearchDocument } from "./tool-search";

const doc = (name: string, body = "", extra: Partial<ToolSearchDocument> = {}): ToolSearchDocument => ({
  name,
  label: name,
  body,
  ...extra,
});
const rank = (docs: ToolSearchDocument[], query: string) =>
  searchTools(docs, (item) => item, query).map((hit) => hit.item.name);

test("inflections of a word meet without merging unrelated words", () => {
  const shares = (a: string, b: string) => wordForms(a).some((form) => wordForms(b).includes(form));
  for (const [a, b] of [
    ["deleted", "delete"],
    ["deleting", "deletes"],
    ["starred", "star"],
    ["libraries", "library"],
    ["highlighting", "highlight"],
    ["saved", "save"],
    ["stats", "stat"],
  ])
    expect(shares(a!, b!)).toBe(true);
  expect(shares("stats", "state")).toBe(false);
  expect(shares("status", "state")).toBe(false);
  expect(tokenize("get_book_content_state sourceLocal")).toEqual([
    "get",
    "book",
    "content",
    "state",
    "source",
    "local",
  ]);
  expect(tokenize("the status of a class")).toEqual(["status", "class"]);
});

test("a rare word outweighs a word every tool contains", () => {
  const docs = [
    doc("get_book_overview", "book metadata"),
    doc("list_books", "every book"),
    doc("open_book", "open a book"),
    doc("get_sync_status", "sync state"),
  ];
  expect(rank(docs, "book sync")[0]).toBe("get_sync_status");
});

test("the name counts more than the description, and a keyword counts like the name", () => {
  const docs = [
    doc("update_book", "change title or star", { keywords: ["favorite"] }),
    doc("list_bookmarks", "a favorite place can be a bookmark"),
    doc("export_text_file", "save text"),
  ];
  expect(rank(docs, "favorite")).toEqual(["update_book", "list_bookmarks"]);
});

test("a long description does not win by mentioning everything once", () => {
  const filler = Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ");
  const docs = [
    doc("get_operation_availability", `${filler} backup clipboard window`),
    doc("request_backup", "export a backup"),
    doc("other", "unrelated"),
  ];
  expect(rank(docs, "backup")[0]).toBe("request_backup");
});

test("no shared word, no hit; stopwords alone are not a query", () => {
  expect(rank([doc("list_books", "every book")], "zebra")).toEqual([]);
  expect(rank([doc("list_books", "every book")], "how do I use the tool")).toEqual([]);
});

test("schema wording covers property names, enum values and nested descriptions", () => {
  const words = schemaWording({
    type: "object",
    properties: {
      action: { enum: ["pause", "resume"] },
      request: { anyOf: [{ description: "Start a sync cycle", properties: { operation: { const: "now" } } }] },
    },
  });
  for (const word of ["action", "pause", "resume", "request", "Start a sync cycle", "operation", "now"])
    expect(words).toContain(word);
});

test("every discovery hint names a real tool, and companions are tools too", () => {
  const { deps } = createInMemoryDeps();
  // These groups exist only when the host supplies their port; only their names matter here.
  deps.transactions = () => ({}) as never;
  deps.jobs = () => ({}) as never;
  deps.changes = () => ({}) as never;
  deps.pluginServices = {} as never;
  const names = new Set(
    [
      { kind: "book", bookId: "b" as Id },
      { kind: "global", threadId: "g" },
    ].flatMap((scope) => buildAgentTools(scope as never, deps, undefined).map((tool) => tool.name)),
  );
  const unknown = Object.entries(TOOL_DISCOVERY_HINTS).flatMap(([name, hint]) =>
    [name, ...(hint.companions ?? [])].filter((item) => !names.has(item)),
  );
  expect([...new Set(unknown)]).toEqual([]);
});
