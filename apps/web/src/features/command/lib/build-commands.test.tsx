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
    openBook: noop,
    openCollection: noop,
    goShelf: noop,
    goAgent: noop,
    goStats: noop,
    openSettings: noop,
    importBook: noop,
    startSelection: noop,
    setLayout: noop,
    setSort: noop,
    setGroup: noop,
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
});
