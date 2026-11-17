import { describe, expect, test } from "bun:test";
import type { TFunction } from "i18next";
import type { CommandContext, CommandDestination } from "./build-commands";
import { buildCommands } from "./build-commands";

const noop = () => {};
const DESTINATIONS: CommandDestination[] = [
  { id: "core:library", topNav: "shelf", title: "Library", icon: null, hostCommand: { id: "go-shelf" } },
  { id: "core:agent", topNav: "agent", title: "Agent", icon: null, hostCommand: { id: "go-context" } },
  { id: "core:annotations", topNav: "annotations", title: "Notes", icon: null, open: noop },
  { id: "plugin:rss:feeds", topNav: "plugin:rss:feeds", title: "Feeds", icon: null, disabled: true, open: noop },
];
const t = ((key: string) => key) as unknown as TFunction<"command">;

function context(readingBookId: string | null, activeTopNav: CommandContext["activeTopNav"] = "shelf"): CommandContext {
  return {
    activeTopNav,
    destinations: DESTINATIONS,
    readingBookId,
    shelfView: { layout: "grid", group: "none", sort: "recent" },
    collections: [],
    books: [],
    importBook: noop,
    importFolder: noop,
  };
}

describe("buildCommands", () => {
  test("omits the Library destination while already on the Library surface", () => {
    const commands = buildCommands(context(null), t);
    expect(commands.some((command) => command.id === "go-core:library")).toBe(false);
  });

  test("offers the Library destination while a reader is open", () => {
    const commands = buildCommands(context("book-1"), t);
    expect(commands.some((command) => command.id === "go-core:library")).toBe(true);
  });

  test("Go to lists every destination it is given, but the page already showing", () => {
    const goto = (ctx: CommandContext) =>
      buildCommands(ctx, t)
        .filter((command) => command.group === "goto" && command.id.startsWith("go-"))
        .map((command) => command.id);
    expect(goto(context(null, "annotations"))).toEqual(["go-core:library", "go-core:agent", "go-plugin:rss:feeds"]);
    // With a book open the reader covers every page, including the current one.
    expect(goto(context("book-1", "annotations"))).toEqual([
      "go-core:library",
      "go-core:agent",
      "go-core:annotations",
      "go-plugin:rss:feeds",
    ]);
  });

  test("a destination runs its host command, or opens like a header click, and keeps its state", () => {
    const opened: string[] = [];
    const ctx = context(null);
    ctx.destinations = DESTINATIONS.map((destination) =>
      destination.hostCommand ? destination : { ...destination, open: () => opened.push(destination.id) },
    );
    const commands = buildCommands(ctx, t);
    expect(commands.find((command) => command.id === "go-core:agent")?.hostCommand).toEqual({ id: "go-context" });
    void commands.find((command) => command.id === "go-core:annotations")?.perform?.();
    expect(opened).toEqual(["core:annotations"]);
    expect(commands.find((command) => command.id === "go-plugin:rss:feeds")?.disabled).toBe(true);
  });

  test("native actions carry typed requests; book and collection render IDs never become command IDs", () => {
    const ctx = context(null);
    ctx.books = [{ id: "b-1", title: "Book", updatedAt: "2026-09-10" }] as never;
    ctx.collections = [{ id: "c-1", name: "Collection", createdAt: "2026-09-10" }];
    const commands = buildCommands(ctx, t);
    expect(commands.find((c) => c.id === "book-b-1")?.hostCommand).toEqual({
      id: "open-book",
      args: { bookId: "b-1" },
    });
    expect(commands.find((c) => c.id === "collection-c-1")?.hostCommand).toEqual({
      id: "open-collection",
      args: { collectionId: "c-1" },
    });
    // UI actions are the imports (each opens a system picker the user drives)
    // and the pages the host command catalog does not cover, which open like
    // a header click.
    const pickers = new Set(["import", "import-folder", "go-core:annotations", "go-plugin:rss:feeds"]);
    expect(commands.filter((c) => !pickers.has(c.id)).every((c) => c.hostCommand && !c.perform)).toBe(true);
    expect(commands.find((c) => c.id === "import")?.perform).toBe(noop);
    expect(commands.find((c) => c.id === "import-folder")?.perform).toBe(noop);
  });
});
