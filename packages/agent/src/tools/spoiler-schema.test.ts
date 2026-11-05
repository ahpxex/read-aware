import { expect, test } from "bun:test";
import type { Id } from "@read-aware/core";
import { createInMemoryDeps } from "../testing/fixtures";
import { buildBookImageTools } from "./book-image-tools";
import { buildBookTextTools } from "./book-text-tools";
import { buildGraphTools } from "./graph-tools";
import { buildInteractionTools } from "./interaction-tools";
import { buildNavigationTools } from "./navigation-tools";
import { buildReferenceTools } from "./reference-tools";
import { createAgentTurnState } from "./turn-state";

const BOOK = "spoiler-schema-book" as Id;
const AFFECTED_TOOL_NAMES = [
  "read_chapter",
  "search_book_text",
  "query_book_graph",
  "find_book_locations",
  "read_book_range",
  "list_book_references",
  "read_book_reference",
  "show_book_reference",
  "list_book_images",
  "open_book_image_resource",
  "show_book_image",
  "read_book_image",
];

function fixture() {
  const { deps } = createInMemoryDeps({
    books: [{ id: BOOK, title: "Fenced Novel", status: "reading", narrativity: "narrative" }],
    chapters: {
      [BOOK]: [
        { title: "Safe", text: "safe text" },
        { title: "Future", text: "future spoiler text" },
      ],
    },
  });
  const scope = { kind: "book" as const, bookId: BOOK };
  const state = createAgentTurnState();
  state.spoilerFence = { throughChapterIndex: 0, readerChapterIndex: 1 };
  return { deps, scope, state };
}

function affectedTools(
  scope: { kind: "book"; bookId: Id } | { kind: "global"; threadId: string },
  deps: ReturnType<typeof fixture>["deps"],
  state: ReturnType<typeof createAgentTurnState>,
) {
  const tools = [
    ...buildBookTextTools(scope, deps, state),
    ...buildGraphTools(scope, deps, state),
    ...buildNavigationTools(scope, deps, state),
    ...buildReferenceTools(scope, deps, state),
    ...buildBookImageTools(scope, deps, state),
  ];
  return tools.filter((tool) => AFFECTED_TOOL_NAMES.includes(tool.name));
}

function exposesSpoilerArgument(tool: { parameters: unknown }): boolean {
  const parameters = tool.parameters as { properties?: Record<string, unknown> };
  return Object.prototype.hasOwnProperty.call(parameters.properties ?? {}, "confirmSpoiler");
}

test("spoiler capability is absent without host grant and in global scope", () => {
  const { deps, scope, state } = fixture();
  expect(affectedTools(scope, deps, state).every((tool) => !exposesSpoilerArgument(tool))).toBe(true);

  state.spoilerPermissionGranted = true;
  expect(
    affectedTools({ kind: "global", threadId: "global" }, deps, state).every((tool) => !exposesSpoilerArgument(tool)),
  ).toBe(true);
});

test("ask_user grant appears after tool rebuild and permits an explicit cross-fence read", async () => {
  const { deps, scope, state } = fixture();
  expect(affectedTools(scope, deps, state).every((tool) => !exposesSpoilerArgument(tool))).toBe(true);

  deps.interactions.request = async () => ({ optionId: "allow", text: "可以剧透" });
  const askUser = buildInteractionTools(scope, deps, state).find((tool) => tool.name === "ask_user");
  if (!askUser) throw new Error("ask_user was not registered");
  await askUser.execute("ask", {
    question: "要不要剧透？",
    options: [
      { id: "allow", label: "允许剧透" },
      { id: "decline", label: "不要剧透" },
    ],
  });

  expect(state.spoilerPermissionGranted).toBe(true);
  const rebuilt = affectedTools(scope, deps, state);
  expect(rebuilt.every((tool) => exposesSpoilerArgument(tool))).toBe(true);

  const readChapter = rebuilt.find((tool) => tool.name === "read_chapter");
  if (!readChapter) throw new Error("read_chapter was not registered");
  const result = await readChapter.execute("future", { chapterIndex: 1, confirmSpoiler: true });
  expect(result.content[0]).toMatchObject({ type: "text" });
  if (result.content[0]?.type === "text") expect(result.content[0].text).toContain("future spoiler text");
});

test("a forged confirmSpoiler remains rejected when the schema is withheld", async () => {
  const { deps, scope, state } = fixture();
  const readChapter = buildBookTextTools(scope, deps, state).find((tool) => tool.name === "read_chapter");
  if (!readChapter) throw new Error("read_chapter was not registered");
  expect(exposesSpoilerArgument(readChapter)).toBe(false);

  await expect(readChapter.execute("forged", { chapterIndex: 1, confirmSpoiler: true })).rejects.toThrow(
    "reader has not explicitly granted spoiler permission",
  );
  expect(state.spoilerPermissionDenied).toBe(true);
});

test("an unadvertised confirmSpoiler on the current book is rejected as a self-grant before validation", () => {
  const { deps, scope, state } = fixture();
  const tools = affectedTools(scope, deps, state);
  expect(tools).toHaveLength(AFFECTED_TOOL_NAMES.length);
  const ids = (bookId: string) => ({ bookId, range: { bookId }, image: { bookId }, reference: { bookId } });
  for (const tool of tools) {
    state.spoilerPermissionDenied = false;
    expect(() => tool.prepareArguments?.({ ...ids(BOOK), confirmSpoiler: true })).toThrow("not explicitly granted");
    expect(state.spoilerPermissionDenied).toBe(true);

    // Aimed at another book, the argument carries no grant: it is dropped, not reported.
    state.spoilerPermissionDenied = false;
    expect(tool.prepareArguments?.({ ...ids("other-book"), confirmSpoiler: true })).toEqual(ids("other-book"));
    expect(state.spoilerPermissionDenied).toBe(false);
  }
});

test("an advertised confirmSpoiler reaches validation unchanged", () => {
  const { deps, scope, state } = fixture();
  state.spoilerPermissionGranted = true;
  const tools = affectedTools(scope, deps, state);
  expect(tools.every((tool) => exposesSpoilerArgument(tool) && tool.prepareArguments === undefined)).toBe(true);
});
