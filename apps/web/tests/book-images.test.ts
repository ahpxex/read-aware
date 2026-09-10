import { expect, test } from "bun:test";
import { normalizeBookImageQuery, normalizeBookImagesQuery, type BookImagesQuery } from "@read-aware/core";
import type { Book } from "../foliate-js/src/book";
import { contentCFI } from "../foliate-js/src/content-navigation";
import { EPUB } from "../foliate-js/src/epub";
import { MOBI } from "../foliate-js/src/mobi";
import { unzlibSync } from "../public/foliate-js/vendor/fflate.js";
import { makeFB2 } from "../foliate-js/src/fb2";
import { makeComicBook } from "../foliate-js/src/comic-book";
import { listImagesInBook, readImageInBook } from "../src/features/library/lib/book-images";
import { makeEPUBFixture } from "./fixtures/foliate-epub";
import { makeMOBI6Fixture, makeKF8Fixture } from "./fixtures/foliate-mobi";
import { fb2Fixture } from "./fixtures/foliate-books";
import { withDom } from "./helpers/foliate-dom";
import { buildPluginContext } from "../src/features/plugins/runtime/plugin-context";

const query = { bookId: "book", contentVersion: "v1", sectionIndex: 0 };
const image = (index = 0) => ({ ...query, index });
test("image discovery pages source elements without loading bytes and preserves source fences", () => withDom(async () => {
  const doc = new DOMParser().parseFromString('<img src="first.png" alt="First"><img zy-footnote="note"><img src="https://example.com/a"><svg><image href="last.png"/></svg>', "text/html");
  let reads = 0, docs = 0;
  const book: Book = { sections: [{ id: "chapter", size: 100, load: () => "", createDocument: () => { docs++; return doc; },
    loadImage: async () => { reads++; return new Blob(["pixels"]); } }] };
  await expect(listImagesInBook(book, query, contentCFI, new Set())).rejects.toMatchObject({ code: "library/range-forbidden" });
  expect(docs).toBe(0);
  const first = await listImagesInBook(book, { ...query, limit: 1 }, contentCFI);
  expect(first).toMatchObject({ total: 3, nextOffset: 1, items: [{ image: image(), alt: "First" }] });
  expect(first.items[0].location?.cfi).toStartWith("epubcfi(");
  const last = await listImagesInBook(book, { ...query, offset: 1 }, contentCFI);
  expect(last.nextOffset).toBeNull(); expect(reads).toBe(0);
  expect(JSON.stringify(last)).not.toContain("https://");
  expect((await readImageInBook(book, { image: image(1) }, contentCFI)).status).toBe("external");
  expect(reads).toBe(0);
  expect((await readImageInBook(book, { image: image(9) }, contentCFI)).status).toBe("missing");
  doc.querySelector("img")!.setAttribute("src", "blob:foreign");
  expect((await readImageInBook(book, { image: image() }, contentCFI)).status).toBe("unsupported");
  expect(reads).toBe(0);
  delete book.sections[0].createDocument;
  expect(await listImagesInBook(book, query, contentCFI)).toMatchObject({ status: "unsupported", total: 0 });
}));

test("EPUB, FB2, MOBI6, KF8 and comic image reads use their actual parser sources", () => withDom(async () => {
  const epub = makeEPUBFixture();
  let archiveReads = 0;
  const load = epub.archive.loadBlob;
  epub.archive.loadBlob = async path => { archiveReads++; return load(path); };
  const books: Array<{ book: Book; sectionIndex: number; marker?: string }> = [
    { book: await new EPUB(epub.archive).init(), sectionIndex: 0, marker: "<svg" },
    { book: await makeFB2(new Blob([fb2Fixture])), sectionIndex: 0 },
    { book: await new MOBI({ unzlib: unzlibSync }).open(makeMOBI6Fixture().file), sectionIndex: 2 },
    { book: await new MOBI({ unzlib: unzlibSync }).open(makeKF8Fixture().file), sectionIndex: 0 },
    { book: makeComicBook({ entries: [{ filename: "1.png" }], getSize: () => 6, loadBlob: () => new Blob(["pixels"]) }, {}), sectionIndex: 0, marker: "pixels" },
  ];
  try {
    for (const { book, sectionIndex, marker } of books) {
      const page = await listImagesInBook(book, { ...query, sectionIndex }, contentCFI);
      expect(page.status).toBe("available"); expect(page.items.length).toBeGreaterThan(0);
      if (book === books[0].book) expect(archiveReads).toBe(0);
      const result = await readImageInBook(book, { image: page.items[0].image }, contentCFI);
      expect(result.status).toBe("ready");
      if (result.status !== "ready") throw Error("Expected embedded image");
      if (marker) expect(await result.blob.text()).toContain(marker);
      else expect([...new Uint8Array(await result.blob.arrayBuffer()).slice(0, 4)]).toEqual([137, 80, 78, 71]);
    }
  } finally { for (const { book } of books) await book.destroy?.(); }
}));

test("image validation, byte limits and cancellation fail before publishing a resource", () => withDom(async () => {
  for (const patch of [{ limit: 51 }, { offset: -1 }, { sectionIndex: 0.5 }, { allowedHrefs: ["secret"] }]) {
    expect(() => normalizeBookImagesQuery({ ...query, ...patch })).toThrow();
  }
  expect(() => normalizeBookImageQuery({ image: { ...image(), src: "file://secret" } } as { image: ReturnType<typeof image> })).toThrow();
  const doc = new DOMParser().parseFromString('<img src="data:image/png;base64,not valid!">', "text/html");
  const book: Book = { sections: [{ id: "chapter", size: 100, load: () => "", createDocument: () => doc }] };
  await expect(readImageInBook(book, { image: image() }, contentCFI)).rejects.toMatchObject({ code: "ui/invalid-target" });
  doc.querySelector("img")!.setAttribute("src", "local.png");
  book.sections[0].loadImage = () => new Blob([new Uint8Array(16 * 1024 * 1024 + 1)]);
  await expect(readImageInBook(book, { image: image() }, contentCFI)).rejects.toMatchObject({ code: "ui/invalid-target" });
  const abort = new AbortController();
  book.sections[0].loadImage = async () => { abort.abort(Error("cancelled")); return new Blob(["pixels"]); };
  await expect(readImageInBook(book, { image: image() }, contentCFI, undefined, abort.signal)).rejects.toThrow("cancelled");
}));

test("public image queries are library-granted and cannot inject host-only scope parameters", async () => {
  for (const permissions of [[], ["library:read"], ["library:write"]] as const) {
    const plugin = buildPluginContext({ id: "images", name: "Images", version: "1", schemaVersion: 1, requires: {}, permissions: [...permissions] }, "1", []);
    plugin.lifecycle.promote();
    const books = plugin.context.domains.library?.queries.books;
    expect(!!books).toBe(permissions.length > 0);
    if (books) {
      expect(books.openImageResource).toBeFunction();
      await expect(books.listImages({ ...query, allowedHrefs: [] } as BookImagesQuery)).rejects.toMatchObject({ code: "library/invalid-query" });
    }
    plugin.lifecycle.stop(); await plugin.lifecycle.drainCleanups();
    if (books) expect(() => books.openImageResource({ image: image() })).toThrow();
  }
});
