import { expect, test } from "bun:test";
import { openBookArchive, type BookArchivePort } from "./book-archive";

function fixture(overrides: Partial<BookArchivePort> = {}) {
  const calls: { texts: string[][]; fetched: string[] } = { texts: [], fetched: [] };
  const files: Record<string, string> = {
    "META-INF/container.xml": "<container/>",
    "OEBPS/content.opf": "<package/>",
    "OEBPS/toc.ncx": "<ncx/>",
    "OEBPS/Text/one.xhtml": "<html/>",
    "OEBPS/Images/a b#1.png": "PNG",
  };
  const port: BookArchivePort = {
    open: async () => ({
      contentVersion: "sha256:abc",
      entries: Object.entries(files).map(([name, text]) => ({ name, size: text.length })),
    }),
    texts: async (_bookId, _version, names) => {
      calls.texts.push(names);
      return names.map((name) => files[name] ?? null);
    },
    resourceUrl: (path) => `rablob://localhost/${path}`,
    fetch: async (url) => {
      calls.fetched.push(url);
      return new Response("PNG", { headers: { "content-type": "image/png" } });
    },
    ...overrides,
  };
  return { port, calls };
}

test("the package documents are fetched together once; other documents are asked for by name", async () => {
  const { port, calls } = fixture();
  const archive = (await openBookArchive("book-1", "book.epub", "application/epub+zip", port))!;
  expect(calls.texts).toEqual([["META-INF/container.xml", "OEBPS/content.opf", "OEBPS/toc.ncx"]]);
  expect(await archive.loadText("META-INF/container.xml")).toBe("<container/>");
  expect(await archive.loadText("OEBPS/content.opf")).toBe("<package/>");
  expect(calls.texts).toHaveLength(1);
  // Not in the archive: answered from the directory, without asking.
  expect(await archive.loadText("META-INF/encryption.xml")).toBeNull();
  expect(calls.texts).toHaveLength(1);
  expect(await archive.loadText("OEBPS/Text/one.xhtml")).toBe("<html/>");
  // A package document read again is read from the archive, not kept here.
  expect(await archive.loadText("OEBPS/content.opf")).toBe("<package/>");
  expect(calls.texts.slice(1)).toEqual([["OEBPS/Text/one.xhtml"], ["OEBPS/content.opf"]]);
  expect(archive.getSize("OEBPS/content.opf")).toBe(10);
  expect(archive.getSize("absent")).toBe(0);
  expect(archive.entries).toContainEqual({ filename: "OEBPS/Text/one.xhtml" });
});

test("a resource is named by a URL pinned to the content, with the entry as one encoded segment", async () => {
  const { port, calls } = fixture();
  const archive = (await openBookArchive("book-1", "book.epub", "application/epub+zip", port))!;
  const url = "rablob://localhost/book/book-1/abc/OEBPS%2FImages%2Fa%20b%231.png";
  expect(archive.resourceURL?.("OEBPS/Images/a b#1.png")).toBe(url);
  expect(archive.resourceURL?.("OEBPS/Images/absent.png")).toBeNull();
  const blob = await archive.loadBlob("OEBPS/Images/a b#1.png");
  expect(calls.fetched).toEqual([url]);
  expect(blob?.type).toBe("image/png");
  expect(await blob?.text()).toBe("PNG");
  expect(await archive.loadBlob("OEBPS/Images/absent.png")).toBeNull();
  expect(calls.fetched).toHaveLength(1);
});

test("a book whose file is not on this device has no archive; a listed entry that cannot be read is an error", async () => {
  expect(await openBookArchive("book-1", "book.epub", "", fixture({ open: async () => null }).port)).toBeNull();
  const refused = fixture({ fetch: async () => new Response(null, { status: 404 }) });
  const archive = (await openBookArchive("book-1", "book.epub", "", refused.port))!;
  await expect(archive.loadBlob("OEBPS/Images/a b#1.png")).rejects.toMatchObject({
    code: "library/content-unavailable",
  });
  const failing = fixture({
    texts: async () => {
      throw new Error("ipc down");
    },
  });
  // Opening does not fail for the documents sent ahead; reading one does.
  const broken = (await openBookArchive("book-1", "book.epub", "", failing.port))!;
  await expect(broken.loadText("OEBPS/content.opf")).rejects.toThrow("ipc down");
});
