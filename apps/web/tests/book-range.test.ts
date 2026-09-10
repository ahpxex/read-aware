import { expect, test } from "bun:test";
import type { Book } from "../foliate-js/src/book";
import { contentCFI, searchContentSection } from "../foliate-js/src/content-navigation";
import { captureContentRange, readContentRange, resolveContentCFI } from "../foliate-js/src/content-range";
import { searchLocationsInBook } from "../src/features/library/lib/book-location-search";
import { contentSections } from "../src/features/library/lib/book-content-sections";
import { withDom } from "./helpers/foliate-dom";

const options = { offset: 0, limit: 4000, contextChars: 240 };
const allow = () => {};
const pdf = (text: string): Book => ({ sections: [{ id: "page", size: text.length, load: () => "", getText: async () => text }] });

test("native DOM and PDF selections produce source-readable ranges, not text-layer paths", () => withDom(async () => {
  document.body.innerHTML = '<div class="textLayer"><span>first needle here; second </span><span>needle there</span></div><div>not PDF text</div>';
  const range = document.createRange(), node = document.querySelectorAll("span")[1].firstChild!;
  range.setStart(node, 0); range.setEnd(node, 6);
  const book = pdf("first needle here; second needle there");
  const captured = captureContentRange(book, 0, range);
  expect(captured).toEqual({ cfi: "epubcfi(/6/2)", textQuote: { exact: "needle", prefix: "first needle here; second ", suffix: " there" } });
  expect((await readContentRange(book, captured, options, allow)).text).toBe("needle");
  book.sections[0].createDocument = () => document;
  const dom = captureContentRange(book, 0, range);
  expect(dom.textQuote).toBeUndefined();
  expect((await readContentRange(book, dom, options, allow)).text).toBe("needle");
  delete book.sections[0].createDocument;
  range.selectNodeContents(document.body.lastElementChild!);
  expect(() => captureContentRange(book, 0, range)).toThrow();
}));

test("search ranges read across inline nodes with bounded context, without a renderer or DOM mutation", () => withDom(async () => {
  document.body.innerHTML = '<p>before Nee<em>dle</em> after</p><script>not context</script><style>p { color: red; }</style>';
  const original = document.body.innerHTML;
  const book: Book = { sections: [{ id: "one", size: 100, load: () => "", createDocument: () => document }] };
  const hits = await searchLocationsInBook(book, "v1", { bookId: "book", query: "needle" }, searchContentSection);
  expect(hits.hits[0].range).toEqual(hits.hits[0].location);
  const page = await readContentRange(book, hits.hits[0].range, { ...options, limit: 3, contextChars: 4 }, allow);
  expect(page).toMatchObject({ text: "Nee", totalLength: 6, nextOffset: 3, context: { before: "ore ", after: " aft" } });
  expect(await readContentRange(book, { cfi: page.cfi }, { ...options, offset: page.nextOffset!, contextChars: 0 }, allow))
    .toMatchObject({ text: "dle", nextOffset: null, context: { before: "", after: "" } });
  expect(document.body.innerHTML).toBe(original);
}));

test("DOM CFI disambiguates duplicates; a quote must agree and cannot relocate the anchor", () => withDom(async () => {
  document.body.innerHTML = '<p>first needle here; second needle there</p>';
  const book: Book = { sections: [{ id: "one", size: 100, load: () => "", createDocument: () => document }] };
  const { hits } = await searchLocationsInBook(book, "v1", { bookId: "book", query: "needle" }, searchContentSection);
  expect((await readContentRange(book, { ...hits[0].range, textQuote: { exact: "needle" } }, options, allow)).text).toBe("needle");
  for (const textQuote of [{ exact: "else" }, { exact: "needle", prefix: "second " }, { exact: "needle", suffix: " there" }]) {
    await expect(readContentRange(book, { ...hits[0].range, textQuote }, options, allow)).rejects.toMatchObject({ reason: "not-found" });
  }
}));

test("a PDF range requires a unique quote and the canonical page CFI", async () => {
  const book = pdf("first needle here; second needle there");
  expect(resolveContentCFI(book, contentCFI(book, 0))).toEqual({ index: 0 });
  const { hits } = await searchLocationsInBook(book, "v1", { bookId: "book", query: "needle" }, searchContentSection);
  expect((await readContentRange(book, hits[1].range, options, allow)).context.before).toBe("first needle here; second ");
  await expect(readContentRange(book, { cfi: contentCFI(book, 0), textQuote: { exact: "needle" } }, options, allow)).rejects.toMatchObject({ reason: "ambiguous" });
  for (const input of [{ cfi: contentCFI(book, 0) }, { cfi: contentCFI(book, 0), textQuote: { exact: "missing" } },
    { ...hits[0].range, cfi: "epubcfi(/6/2!/4/2,/1:0,/1:6)" },
    { ...hits[0].range, cfi: "epubcfi(/6/2junk)" }]) {
    await expect(readContentRange(book, input, options, allow)).rejects.toMatchObject({ reason: "not-found" });
  }
});

test("quote matching preserves whitespace and UTF-16 offsets without splitting surrogate pairs", async () => {
  const book = pdf("X\u{1F600}nee dle\u{1F600}Y");
  const input = { cfi: contentCFI(book, 0), textQuote: { exact: "\u{1F600}needle\u{1F600}", prefix: "X", suffix: "Y" } };
  let offset = 0, text = "";
  for (;;) {
    const page = await readContentRange(book, input, { ...options, offset, limit: 3 }, allow);
    expect(page.text.isWellFormed()).toBe(true);
    text += page.text;
    if (page.nextOffset === null) break;
    expect(page.nextOffset).toBeGreaterThan(offset);
    offset = page.nextOffset;
  }
  expect(text).toBe("\u{1F600}nee dle\u{1F600}");
  for (const offset of [1, 100]) await expect(readContentRange(book, input, { ...options, offset }, allow)).rejects.toMatchObject({ reason: "invalid-offset" });
  const contextBook = pdf("\u{1F600}needle\u{1F600}");
  expect((await readContentRange(contextBook, { cfi: contentCFI(contextBook, 0), textQuote: { exact: "needle" } }, { ...options, contextChars: 1 }, allow)).context)
    .toEqual({ before: "", after: "" });
});

test("the host fence rejects before loading DOM or PDF text; source errors and abort are not empty results", () => withDom(async () => {
  let reads = 0;
  const failure = new Error("source failed");
  for (const section of [{ createDocument: () => { reads++; throw failure; } }, { getText: () => { reads++; throw failure; } }]) {
    const book: Book = { sections: [{ id: "page", size: 10, load: () => "", ...section }] };
    const input = { cfi: contentCFI(book, 0), textQuote: { exact: "needle" } };
    const fence = new Error("fence");
    await expect(readContentRange(book, input, options, () => { throw fence; })).rejects.toBe(fence);
    expect(reads).toBe(0);
    await expect(readContentRange(book, input, options, allow)).rejects.toBe(failure);
    reads = 0;
  }
  const controller = new AbortController();
  const book = pdf("needle");
  book.sections[0].getText = async () => { controller.abort(); return "needle"; };
  await expect(readContentRange(book, { cfi: contentCFI(book, 0), textQuote: { exact: "needle" } }, options, allow, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
}));

test("invalid, collapsed, script and cross-document anchors are not readable ranges", () => withDom(async () => {
  document.body.innerHTML = '<p>needle</p><script>secret</script>';
  const book: Book = { sections: [{ id: "page", size: 10, load: () => "", createDocument: () => document }] };
  const range = document.createRange(); range.selectNodeContents(document.querySelector("script")!);
  const point = document.createRange(); point.setStart(document.querySelector("p")!.firstChild!, 2); point.collapse(true);
  for (const cfi of [contentCFI(book, 0, range), contentCFI(book, 0, point),
    "epubcfi(/6/99!/4/2,/1:0,/1:6)", "epubcfi(/6/2!/4/2,/1:0,/1:999)",
    "epubcfi(/6/2!/4/2,/1:0!/4,/1:6)", "epubcfi(/6/2!/4/2,/1:6,/1:0)"]) {
    await expect(readContentRange(book, { cfi }, options, allow)).rejects.toMatchObject({ reason: "not-found" });
  }
  delete book.sections[0].createDocument;
  await expect(readContentRange(book, { cfi: contentCFI(book, 0) }, options, allow)).rejects.toMatchObject({ reason: "unsupported" });
}));

test("empty allowed hrefs deny all; canonical ids and resolved hrefs share search/range policy", async () => {
  const book = pdf("text");
  book.resolveHref = href => href === "alias" ? { index: 0 } : undefined;
  expect([...await contentSections(book, [])]).toEqual([]);
  expect([...await contentSections(book, ["page", "alias", "missing"])]).toEqual([0]);
});
