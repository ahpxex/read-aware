import { expect, test } from "bun:test";
import type { Book } from "../foliate-js/src/book";
import { contentCFI, resolveTextQuote, searchContentSection } from "../foliate-js/src/content-navigation";
import * as CFI from "../foliate-js/src/epubcfi";
import { navigationToc, searchLocationsInBook } from "../src/features/library/lib/book-location-search";
import { virtualContentVersion } from "../src/features/library/lib/content-version";
import { withDom } from "./helpers/foliate-dom";

const pdfBook = (...texts: Array<string | null>): Book => ({ sections: texts.map((text, index) => ({
  id: `section-${index}`, size: text?.length ?? 0, load: () => "",
  ...(text === null ? {} : { getText: async () => text }),
})), resolveHref: href => {
  const index = texts.findIndex((_, i) => href === `section-${i}`);
  return index < 0 ? undefined : { index };
} });
const search = (book: Book, input: Partial<Parameters<typeof searchLocationsInBook>[2]> = {}, signal?: AbortSignal) =>
  searchLocationsInBook(book, "revision-1", { bookId: "book", query: "needle", ...input }, searchContentSection, signal);

test("precise DOM search returns ranges across inline nodes and does not mutate the document", () => withDom(async () => {
  document.body.innerHTML = '<p>before Nee<em>dle</em> after needlework</p><script>needle</script>';
  const original = document.body.innerHTML;
  const book: Book = { sections: [{ id: "one", size: 100, load: () => "", createDocument: () => document }] };
  const result = await search(book, { wholeWords: true });
  expect(result.hits).toHaveLength(1);
  expect(result.hits[0].excerpt.match).toBe("Needle");
  const parts = CFI.parse(result.hits[0].location.cfi!);
  (Array.isArray(parts) ? parts : parts.parent).shift();
  const range = CFI.toRange(document, parts);
  expect(range.toString()).toBe("Needle");
  expect(document.body.innerHTML).toBe(original);
  expect((await search(book, { wholeWords: true, matchCase: true })).hits).toHaveLength(0);
}));

test("PDF extraction uses a versioned page location plus disambiguating text quote", async () => {
  const result = await search(pdfBook("first needle here; second needle there"), { limit: 1 });
  expect(result.hits[0].location).toMatchObject({ bookId: "book", contentVersion: "revision-1", cfi: contentCFI(pdfBook(""), 0), textQuote: { exact: "needle", prefix: "first ", suffix: " here; second needle there" } });
  expect(result.nextCursor).not.toBeNull();
});

test("PDF quotes resolve across text-layer whitespace, preserving UTF-16 range offsets", () => withDom(() => {
  document.body.innerHTML = '<p>needle outside</p><div class="textLayer"><span>first </span><span>nee</span><span>dle here; </span><span>second needle there</span></div>';
  const range = resolveTextQuote(document, { exact: "nee dle", prefix: "first", suffix: "here; second" });
  expect(range.toString()).toBe("needle");
  expect(() => resolveTextQuote(document, { exact: "needle" })).toThrow("ambiguous");
  expect(() => resolveTextQuote(document, { exact: "missing" })).toThrow("no longer resolves");
  document.querySelector('.textLayer')!.innerHTML = '<span>A\u{1F600}</span><span>B</span>';
  expect(resolveTextQuote(document, { exact: "\u{1F600}B" }).toString()).toBe("\u{1F600}B");
}));

test("pagination neither skips nor duplicates hits within and across sections", async () => {
  const book = pdfBook("needle needle needle", "none", "needle needle");
  const hits = [];
  let cursor: string | undefined;
  do {
    const page = await search(book, { limit: 2, cursor });
    hits.push(...page.hits.map(hit => hit.id));
    cursor = page.nextCursor ?? undefined;
    expect(page.textStatus).toBe("available");
  } while (cursor);
  expect(hits).toEqual(["0:0", "0:1", "0:2", "2:0", "2:1"]);
});

test("a bounded empty batch is not evidence of a textless book", async () => {
  const book = pdfBook(...Array<string>(32).fill(""), "needle");
  const first = await search(book);
  expect(first).toMatchObject({ hits: [], textStatus: "partial", scannedSections: 32, totalSections: 33 });
  const last = await search(book, { cursor: first.nextCursor! });
  expect(last).toMatchObject({ textStatus: "available", nextCursor: null, scannedSections: 33 });
  expect(last.hits).toHaveLength(1);
});

test("cursor state does not invent text in unsupported or empty sections", async () => {
  for (const [value, status] of [[null, "unsupported"], ["", "textless"]] as const) {
    const book = pdfBook(...Array(33).fill(value));
    const first = await search(book);
    const last = await search(book, { cursor: first.nextCursor! });
    expect(last.textStatus).toBe(status);
  }
  expect((await search(pdfBook(null, ""))).textStatus).toBe("partial");
  expect((await search(pdfBook("needle"), { hrefs: [] })).textStatus).toBe("unsearched");
});

test("continuations are bound to query, actor-selected scope, book and revision", async () => {
  const book = pdfBook("needle needle", "needle");
  const first = await search(book, { limit: 1 });
  for (const change of [{ query: "other" }, { bookId: "other" }, { matchCase: true }, { wholeWords: true }, { hrefs: ["section-0"] }]) {
    await expect(search(book, { cursor: first.nextCursor!, ...change })).rejects.toMatchObject({ code: "library/invalid-cursor" });
  }
  await expect(searchLocationsInBook(book, "revision-2", { bookId: "book", query: "needle", cursor: first.nextCursor! }, searchContentSection)).rejects.toMatchObject({ code: "reader/stale-location" });
  await expect(search(book, { contentVersion: "old" })).rejects.toMatchObject({ code: "reader/stale-location" });
});

test("malformed requests are rejected before any section is read", async () => {
  let reads = 0;
  const book = pdfBook("needle");
  book.sections[0].getText = async () => { reads++; return "needle"; };
  for (const input of [{ limit: 0 }, { limit: 51 }, { query: " " }, { query: "x".repeat(501) }, { cursor: "!" }, { cursor: btoa("null") }]) {
    await expect(search(book, input)).rejects.toBeDefined();
  }
  expect(reads).toBe(0);
});

test("abort after asynchronous content extraction rejects rather than returning an empty success", async () => {
  const controller = new AbortController();
  const book = pdfBook("needle");
  book.sections[0].getText = async () => { controller.abort(); return "needle"; };
  await expect(search(book, {}, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
});

test("TOC hierarchy preserves non-navigable headings and does not pretend ordinals are printed numbers", async () => {
  const book = pdfBook("one", "two");
  book.toc = [{ label: "Part One", href: null, subitems: [
    { label: "Chapter 12", href: "section-0" }, { label: "Missing", href: "missing" },
  ] }, { label: "Chapter 20", href: "section-1" }];
  const toc = await navigationToc(book, "book", "v1");
  expect(toc.entries[0]).toMatchObject({ ordinal: 1, location: null });
  expect(toc.entries[0].children[0]).toMatchObject({ ordinal: 2, label: "Chapter 12", location: { href: "section-0", contentVersion: "v1" } });
  expect(toc.entries[0].children[1].location).toBeNull();
  expect(toc.entries[1].ordinal).toBe(4);
});

test("virtual content revisions change with text and order, not incidental object key ordering", async () => {
  const content = { title: "Book", sections: [{ title: "One", html: "<p>one</p>" }, { title: "Two", html: "<p>two</p>" }] };
  const version = await virtualContentVersion(content);
  expect(await virtualContentVersion({ sections: content.sections, title: "Book" })).toBe(version);
  expect(await virtualContentVersion({ ...content, sections: [...content.sections].reverse() })).not.toBe(version);
  expect(await virtualContentVersion({ ...content, sections: [{ ...content.sections[0], html: "changed" }] })).not.toBe(version);
});
