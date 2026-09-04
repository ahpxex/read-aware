import { describe, expect, test } from "bun:test";
import { ensureUsableToc } from "./toc-synthesis";

/** The slice of a parsed document `labelFromDocument` reads. */
function fakeDocument(heading: string): Document {
  const el = { textContent: heading };
  return {
    querySelectorAll: (selector: string) => (selector.startsWith("h1") ? [el] : []),
    body: { querySelectorAll: () => [], children: [] },
  } as unknown as Document;
}

function sections(count: number, id: (index: number) => string | number) {
  return Array.from({ length: count }, (_, index) => ({
    id: id(index),
    createDocument: () => fakeDocument(`Chapter ${index}`),
  }));
}

describe("ensureUsableToc with engine-mapped hrefs (MOBI / KF8)", () => {
  /** A KF8-shaped book: numeric section ids, `kindle:pos:` hrefs, and the
   *  engine's own splitter — file-name matching finds nothing here. */
  function kf8Book(tocCount: number, sectionCount: number) {
    const href = (index: number) => `kindle:pos:fid:${index.toString(32).padStart(4, "0")}:off:0000000000`;
    return {
      toc: Array.from({ length: tocCount }, (_, index) => ({ label: `第${index}章`, href: href(index) })),
      sections: sections(sectionCount, (index) => index),
      splitTOCHref: (value: string) => {
        const match = /kindle:pos:fid:(\w+):off:/.exec(value);
        return match ? [parseInt(match[1]!, 32), null] : [-1, null];
      },
      getSectionHref: (index: number) => href(index),
    };
  }

  test("a nav that covers the spine through the engine mapping is left alone", async () => {
    const book = kf8Book(9, 10);
    const before = book.toc.map((item) => item.href);
    expect(await ensureUsableToc(book)).toBe(false);
    expect(book.toc.map((item) => item.href)).toEqual(before);
  });

  test("a deficient nav gains entries whose hrefs the engine minted", async () => {
    const book = kf8Book(1, 8);
    expect(await ensureUsableToc(book)).toBe(true);
    const hrefs = book.toc.map((item) => item.href);
    expect(hrefs).toHaveLength(8);
    // Every synthesized entry is a real kindle:pos href — never a bare index.
    expect(hrefs.every((href) => href.startsWith("kindle:pos:fid:"))).toBe(true);
    expect(book.toc[0]?.label).toBe("第0章");
    expect(book.toc[3]?.label).toBe("Chapter 3");
  });

  test("a format with a splitter but no href minting adds nothing rather than junk", async () => {
    const book = { ...kf8Book(1, 8), getSectionHref: undefined };
    expect(await ensureUsableToc(book)).toBe(false);
    expect(book.toc).toHaveLength(1);
  });
});

describe("ensureUsableToc with file-path hrefs (EPUB)", () => {
  test("synthesized entries use the section file path", async () => {
    const book = {
      toc: [{ label: "Cover", href: "text/part0.xhtml#top" }],
      sections: sections(6, (index) => `text/part${index}.xhtml`),
    };
    expect(await ensureUsableToc(book)).toBe(true);
    expect(book.toc.map((item) => item.href)).toEqual([
      "text/part0.xhtml#top",
      ...Array.from({ length: 5 }, (_, index) => `text/part${index + 1}.xhtml`),
    ]);
    expect(book.toc[0]?.label).toBe("Cover");
  });
});
