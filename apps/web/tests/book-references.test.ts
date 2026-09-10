import { expect, test } from "bun:test";
import { normalizeBookReferenceQuery, normalizeBookReferencesQuery } from "@read-aware/core";
import type { Book } from "../foliate-js/src/book";
import { contentCFI } from "../foliate-js/src/content-navigation";
import { readContentRange } from "../foliate-js/src/content-range";
import { listReferencesInBook, readReferenceInBook } from "../src/features/library/lib/book-references";
import { withDom } from "./helpers/foliate-dom";
import { buildPluginContext } from "../src/features/plugins/runtime/plugin-context";

const query = { bookId: "book", contentVersion: "v1", sectionIndex: 0 };
const reference = (index = 0) => ({ ...query, index });

test("reference queries follow library discovery grants without exposing a target allowlist", async () => {
  const manifest = { id: "reference-test", name: "References", version: "1.0.0", schemaVersion: 1, requires: {} };
  const denied = buildPluginContext({ ...manifest, permissions: [] }, "1.0.0", []);
  expect(denied.context.domains.library).toBeUndefined();
  for (const permission of ["library:read", "library:write"] as const) {
    const { context, lifecycle } = buildPluginContext({ ...manifest, permissions: [permission] }, "1.0.0", []);
    lifecycle.promote();
    expect(context.domains.library?.queries.books.listReferences).toBeFunction();
    expect(context.domains.library?.queries.books.readReference).toBeFunction();
    await expect(context.domains.library!.queries.books.listReferences({ ...query, allowedHrefs: ["notes"] } as typeof query))
      .rejects.toMatchObject({ code: "library/invalid-query" });
  }
});
function fixture() {
  const source = new DOMParser().parseFromString('<a href="notes#n">1</a><img zy-footnote="Inline note" alt="not used"><a href="https://example.com/note">External</a><a href="javascript:alert(1)">Blocked</a><a href="notes#absent">Absent</a><a href="notes">Section</a>', "text/html");
  const target = new DOMParser().parseFromString('<aside id="n">First <em>note</em> text.<script>hidden script</script><style>hidden style</style></aside>', "text/html");
  let targetReads = 0;
  const book: Book = { sections: [
    { id: "source", size: 100, load: () => "", createDocument: () => source, resolveHref: href => `root/${href}` },
    { id: "notes", size: 100, load: () => "", createDocument: () => { targetReads++; return target; } },
  ], resolveHref: href => {
    if (!href.startsWith("root/notes")) return undefined;
    const hash = href.split("#")[1];
    return { index: 1, anchor: (doc: Document) => hash ? doc.getElementById(hash) : 0 };
  } };
  return { book, source, target, targetReads: () => targetReads };
}

test("reference discovery paginates stable descriptors without resolving targets or returning raw URLs", () => withDom(async () => {
  const { book, targetReads } = fixture();
  const first = await listReferencesInBook(book, { ...query, limit: 2 });
  expect(first).toMatchObject({ status: "available", total: 6, nextOffset: 2 });
  expect(first.items).toEqual([{ reference: reference(0), label: "1", kind: "link" }, { reference: reference(1), label: "", kind: "inline-note" }]);
  const last = await listReferencesInBook(book, { ...query, offset: 2, limit: 50 });
  expect(last.items.map(item => item.reference.index)).toEqual([2, 3, 4, 5]);
  expect(last.nextOffset).toBeNull();
  expect(JSON.stringify(last)).not.toContain("https:");
  expect(targetReads()).toBe(0);
}));

test("link target previews paginate plain text and return a navigable range without changing either document", () => withDom(async () => {
  const { book, source, target } = fixture();
  const original = [source.documentElement.outerHTML, target.documentElement.outerHTML];
  const first = await readReferenceInBook(book, { reference: reference(), limit: 6 }, contentCFI);
  expect(first).toMatchObject({ status: "resolved", text: "First ", totalLength: 16, nextOffset: 6 });
  expect(first.location).toMatchObject({ bookId: "book", contentVersion: "v1" });
  expect((await readContentRange(book, { cfi: first.location!.cfi! }, { offset: 0, limit: 100, contextChars: 0 }, () => {})).text).toBe("First note text.");
  const rest = await readReferenceInBook(book, { reference: reference(), offset: first.nextOffset! }, contentCFI);
  expect(rest.text).toBe("note text.");
  expect(rest.nextOffset).toBeNull();
  expect([source.documentElement.outerHTML, target.documentElement.outerHTML]).toEqual(original);
  expect((await readReferenceInBook(book, { reference: reference(1) }, contentCFI))).toMatchObject({ status: "resolved", text: "Inline note" });
  expect((await readReferenceInBook(book, { reference: reference(5) }, contentCFI))).toMatchObject({ status: "resolved", text: "First note text." });
}));

test("source and destination fences apply before parsing; external, blocked, missing and unsupported stay distinct", () => withDom(async () => {
  const { book, targetReads } = fixture();
  await expect(listReferencesInBook(book, query, new Set())).rejects.toMatchObject({ code: "library/range-forbidden" });
  await expect(readReferenceInBook(book, { reference: reference() }, contentCFI, new Set([0]))).rejects.toMatchObject({ code: "library/range-forbidden" });
  expect(targetReads()).toBe(0);
  expect(await readReferenceInBook(book, { reference: reference(2) }, contentCFI)).toMatchObject({ status: "external", url: "https://example.com/note", text: "" });
  expect(await readReferenceInBook(book, { reference: reference(3) }, contentCFI)).toMatchObject({ status: "blocked", text: "" });
  expect(await readReferenceInBook(book, { reference: reference(4) }, contentCFI)).toMatchObject({ status: "missing", text: "" });
  expect(await readReferenceInBook(book, { reference: reference(99) }, contentCFI)).toMatchObject({ status: "missing" });
  delete book.sections[1].createDocument;
  expect(await readReferenceInBook(book, { reference: reference() }, contentCFI)).toMatchObject({ status: "unsupported" });
  delete book.sections[0].createDocument;
  expect(await listReferencesInBook(book, query)).toMatchObject({ status: "unsupported", items: [] });
}));

test("reference queries reject injected authority, bad bounds, credentials and cancelled reads", () => withDom(async () => {
  for (const patch of [{ allowedHrefs: ["notes"] }, { throughChapterIndex: 100 }, { limit: 51 }, { offset: -1 }, { sectionIndex: 0.5 }, { contentVersion: "" }]) {
    expect(() => normalizeBookReferencesQuery({ ...query, ...patch })).toThrow();
  }
  expect(() => normalizeBookReferenceQuery({ reference: { ...reference(), url: "https://example.com" } })).toThrow();
  const { book, source } = fixture();
  source.querySelector("a")!.setAttribute("href", "https://secret:password@example.com");
  expect(await readReferenceInBook(book, { reference: reference() }, contentCFI)).toMatchObject({ status: "blocked" });
  const controller = new AbortController(); controller.abort(new Error("cancelled"));
  await expect(listReferencesInBook(book, query, undefined, controller.signal)).rejects.toThrow("cancelled");
  await expect(readReferenceInBook(book, { reference: reference(1), offset: 999 }, contentCFI)).rejects.toMatchObject({ code: "library/invalid-query" });
  const during = new AbortController();
  book.sections[0].createDocument = async () => { await Promise.resolve(); during.abort(new Error("during parse")); return source; };
  await expect(listReferencesInBook(book, query, undefined, during.signal)).rejects.toThrow("during parse");
}));
