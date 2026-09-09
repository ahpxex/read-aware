import { expect, test } from "bun:test";
import type { DictionaryPluginContext } from "../src/types";
import { currentBookTitle } from "../src/current-book";

function fixture() {
  let state = { status: "ready", bookId: "a", sessionId: "one" };
  let title = "First title";
  const ctx = { domains: {
    reading: { queries: { session: async () => ({ ...state }) } },
    library: { queries: { books: { get: async () => ({ title }) } } },
  } } as unknown as DictionaryPluginContext;
  return { ctx, setState: (next: typeof state) => { state = next; }, rename: (next: string) => { title = next; } };
}

test("late activation and rename read current facts without waiting for future events", async () => {
  const f = fixture();
  expect(await currentBookTitle(f.ctx)).toBe("First title");
  f.rename("Renamed title");
  expect(await currentBookTitle(f.ctx)).toBe("Renamed title");
  f.setState({ status: "idle", bookId: "", sessionId: "" });
  expect(await currentBookTitle(f.ctx)).toBeUndefined();
});

test("switch, reopen and close during metadata lookup cannot reuse the old title", async () => {
  for (const next of [{ status: "ready", bookId: "b", sessionId: "two" },
    { status: "ready", bookId: "a", sessionId: "two" }, { status: "idle", bookId: "", sessionId: "" }]) {
    const f = fixture();
    f.ctx.domains.library.queries.books.get = async () => {
      f.setState(next);
      return { title: "Old book" } as never;
    };
    expect(await currentBookTitle(f.ctx)).toBeUndefined();
  }
});

test("missing metadata is absent, but a failed read is not disguised as absent", async () => {
  const f = fixture();
  f.ctx.domains.library.queries.books.get = async () => null;
  expect(await currentBookTitle(f.ctx)).toBeUndefined();
  f.ctx.domains.library.queries.books.get = async () => { throw Error("read failed"); };
  await expect(currentBookTitle(f.ctx)).rejects.toThrow("read failed");
});
