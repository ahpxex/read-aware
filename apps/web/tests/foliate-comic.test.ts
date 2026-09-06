import { expect, test } from "bun:test";
import { makeComicBook } from "../foliate-js/src/comic-book.js";

test("comic pages sort numerically, share loads and release resources", async () => {
  let reads = 0;
  const book = makeComicBook({
    entries: ["page10.png", "readme.txt", "page2.png"].map(filename => ({ filename })),
    loadBlob: async () => { reads++; return new Blob(["image"]); },
    getSize: () => 5,
  }, { name: "Comic" });
  expect(book.toc.map(item => item.label)).toEqual(["page2.png", "page10.png"]);
  expect(book.resolveHref("page10.png")).toEqual({ index: 1 });
  expect(book.splitTOCHref("page2.png")).toEqual(["page2.png", null]);
  const [a, b] = await Promise.all([book.sections[0].load(), book.sections[0].load()]);
  expect(a).toBe(b);
  expect(reads).toBe(1);
  expect(await (await fetch(a)).text()).toContain('<img src="blob:');
  book.sections[0].unload();
  await expect(fetch(a)).rejects.toThrow();
  expect(await book.sections[0].load()).not.toBe(a);
  book.destroy();
});

test("failed and cancelled comic loads do not poison the cache", async () => {
  let resolve: (blob: Blob | null) => void = () => { throw new Error("load not started"); };
  const book = makeComicBook({ entries: [{ filename: "page.png" }], getSize: () => 1,
    loadBlob: () => new Promise<Blob | null>(done => { resolve = done; }),
  }, {});
  const missing = book.sections[0].load();
  await Promise.resolve();
  resolve(null);
  await expect(missing).rejects.toThrow("missing");
  const pending = book.sections[0].load();
  await Promise.resolve();
  book.destroy();
  resolve(new Blob(["image"]));
  await expect(pending).rejects.toThrow("cancelled");
  const retry = book.sections[0].load();
  await Promise.resolve();
  resolve(new Blob(["image"]));
  expect(await retry).toStartWith("blob:");
  book.destroy();
});

test("empty comic archives fail rather than opening a blank reader", () => {
  expect(() => makeComicBook({ entries: [], loadBlob: () => null, getSize: () => 0 }, {}))
    .toThrow("No supported image files");
});
