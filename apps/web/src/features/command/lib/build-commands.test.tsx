import { describe, expect, test } from "bun:test";
import type { TFunction } from "i18next";
import type { CommandContext } from "./build-commands";
import { buildCommands } from "./build-commands";

const noop = () => {};
const t = ((key: string) => key) as unknown as TFunction<"command">;

function context(readingBookId: string | null): CommandContext {
  return {
    activeTopNav: "shelf",
    readingBookId,
    shelfView: { layout: "grid", group: "none", sort: "recent" },
    collections: [],
    books: [],
    importBook: noop,
  };
}

describe("buildCommands", () => {
  test("omits the Library destination while already on the Library surface", () => {
    const commands = buildCommands(context(null), t);
    expect(commands.some((command) => command.id === "go-shelf")).toBe(false);
  });

  test("offers the Library destination while a reader is open", () => {
    const commands = buildCommands(context("book-1"), t);
    expect(commands.some((command) => command.id === "go-shelf")).toBe(true);
  });

  test("native actions carry typed requests; book and collection render IDs never become command IDs", () => {
    const ctx = context(null);
    ctx.books = [{ id: "b-1", title: "Book", updatedAt: "2026-09-10" }] as never;
    ctx.collections = [{ id: "c-1", name: "Collection", createdAt: "2026-09-10" }];
    const commands = buildCommands(ctx, t);
    expect(commands.find(c => c.id === "book-b-1")?.hostCommand).toEqual({ id: "open-book", args: { bookId: "b-1" } });
    expect(commands.find(c => c.id === "collection-c-1")?.hostCommand).toEqual({ id: "open-collection", args: { collectionId: "c-1" } });
    expect(commands.filter(c => c.id !== "import").every(c => c.hostCommand && !c.perform)).toBe(true);
    expect(commands.find(c => c.id === "import")?.perform).toBe(noop);
  });
});
