import { expect, test } from "bun:test";
import { normalizeBookNavigationTargetsQuery, type BookNavigationTargetsQuery } from "@read-aware/core";
import { EPUB } from "../foliate-js/src/epub";
import { contentCFI } from "../foliate-js/src/content-navigation";
import { navigationTargetsInBook } from "../src/features/library/lib/book-navigation-targets";
import { makeEPUBFixture } from "./fixtures/foliate-epub";
import { withDom } from "./helpers/foliate-dom";
import { buildPluginContext } from "../src/features/plugins/runtime/plugin-context";
import type { Book } from "../foliate-js/src/book";

const query = { bookId: "book", contentVersion: "v1", kind: "pages" } as const;

test("actual EPUB page labels preserve duplicates and fragments without loading chapter documents", () => withDom(async () => {
  const f = makeEPUBFixture();
  f.files.set("OPS/nav.xhtml", '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="page-list"><ol><li><a href="one.xhtml#start">iv</a></li><li><a href="one.xhtml#start">1</a></li><li><a href="two.xhtml#note">1</a></li><li><a href="https://example.com/remote">remote</a></li></ol></nav></body></html>');
  const book = await new EPUB(f.archive).init();
  let reads = 0;
  for (const section of book.sections) section.createDocument = async () => { reads++; throw Error("No chapter read expected"); };
  try {
    const first = await navigationTargetsInBook(book, { ...query, label: "1", limit: 1 }, contentCFI);
    expect(first).toMatchObject({ status: "available", total: 2, nextOffset: 1, items: [{ index: 1, label: "1", sectionIndex: 0,
      location: { bookId: "book", contentVersion: "v1", href: "OPS/one.xhtml#start" } }] });
    const next = await navigationTargetsInBook(book, { ...query, label: "1", offset: 1 }, contentCFI);
    expect(next).toMatchObject({ nextOffset: null, items: [{ index: 2, sectionIndex: 1, location: { href: "OPS/two.xhtml#note" } }] });
    expect(await navigationTargetsInBook(book, { ...query, label: "99" }, contentCFI)).toMatchObject({ status: "available", total: 0 });
    const remote = await navigationTargetsInBook(book, { ...query, label: "remote" }, contentCFI);
    expect(remote.items[0]?.location).toBeNull(); expect(JSON.stringify(remote)).not.toContain("https://");
    book.sections[1]!.linear = "no";
    const sections = await navigationTargetsInBook(book, { ...query, kind: "sections", offset: 1, limit: 1 }, contentCFI);
    expect(sections).toMatchObject({ total: 2, items: [{ index: 1, sectionIndex: 1, linear: false, label: null,
      location: { cfi: contentCFI(book, 1) } }] });
    expect(reads).toBe(0);
  } finally { book.destroy(); }
}));

test("catalog bounds, missing lists, nested labels, resolver failures and cancellation remain distinct", async () => {
  const book: Book = { sections: [{ id: "page", load: () => "", size: 0 }], resolveHref: () => ({ index: 0 }) };
  expect(await navigationTargetsInBook(book, query, contentCFI)).toMatchObject({ status: "absent", items: [], total: 0 });
  book.pageList = [{ label: "group", subitems: [{ label: "v".repeat(301), href: "page" }] }];
  const page = await navigationTargetsInBook(book, query, contentCFI);
  expect(page.items.map(item => item.index)).toEqual([0, 1]);
  expect(page.items[0]?.location).toBeNull(); expect(page.items[1]?.label).toHaveLength(300); expect(page.items[1]?.labelTruncated).toBe(true);
  await expect(navigationTargetsInBook(book, { ...query, offset: 3 }, contentCFI)).rejects.toMatchObject({ code: "library/invalid-query" });
  book.resolveHref = () => { throw Error("broken source"); };
  await expect(navigationTargetsInBook(book, query, contentCFI)).rejects.toMatchObject({ code: "library/content-unavailable" });
  const abort = new AbortController(); abort.abort(Error("cancelled"));
  await expect(navigationTargetsInBook(book, query, contentCFI, abort.signal)).rejects.toThrow("cancelled");
  for (const extra of [{ kind: "unknown" }, { limit: 51 }, { offset: -1 }, { label: 1 }, { kind: "sections", label: "1" }, { allowedHrefs: [] }]) {
    expect(() => normalizeBookNavigationTargetsQuery({ ...query, ...extra } as BookNavigationTargetsQuery)).toThrow();
  }
});

test("public navigation catalogs require library access and cannot outlive activation", async () => {
  for (const permissions of [[], ["reading:read"], ["library:read"], ["library:write"]] as const) {
    const plugin = buildPluginContext({ id: "navigation", name: "Navigation", version: "1", schemaVersion: 1, requires: {}, permissions: [...permissions] }, "1", []);
    plugin.lifecycle.promote();
    const list = plugin.context.domains.library?.queries.books.listNavigationTargets;
    expect(!!list).toBe(permissions.some(value => value.startsWith("library:")));
    if (list) await expect(list({ ...query, allowedHrefs: [] } as BookNavigationTargetsQuery)).rejects.toMatchObject({ code: "library/invalid-query" });
    plugin.lifecycle.stop(); await plugin.lifecycle.drainCleanups();
    if (list) expect(() => list(query)).toThrow();
  }
});
