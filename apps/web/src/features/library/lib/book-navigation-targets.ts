import { AppError, normalizeBookNavigationTargetsQuery, type BookNavigationTargetsQuery,
  type BookNavigationTargetsPage, type BookNavigationTargetEntry } from "@read-aware/core";
import { loadContentNavigation, type FoliateBook, type FoliateTocItem } from "../../reader/lib/foliate-engine";
import type { contentCFI } from "../../../../foliate-js/src/content-navigation";
import { withBookContent } from "./book-content-source";

function* pageEntries(entries: FoliateTocItem[]) {
  const stack = [entries[Symbol.iterator]()];
  while (stack.length) {
    const item = stack[stack.length - 1]!.next();
    if (item.done) { stack.pop(); continue; }
    yield item.value;
    if (item.value.subitems?.length) stack.push(item.value.subitems[Symbol.iterator]());
  }
}

/** Metadata-only catalog: only this page's links are resolved; no chapter DOM is loaded. */
export async function navigationTargetsInBook(book: FoliateBook, input: BookNavigationTargetsQuery,
  cfi: typeof contentCFI, signal?: AbortSignal): Promise<BookNavigationTargetsPage> {
  const query = normalizeBookNavigationTargetsQuery(input);
  signal?.throwIfAborted();
  const items: BookNavigationTargetEntry[] = [];
  const base = { bookId: query.bookId, contentVersion: query.contentVersion };
  let total = 0;
  let pages: FoliateTocItem[] | null = null;
  if (query.kind === "sections") {
    total = book.sections.length;
    for (let index = query.offset; index < Math.min(total, query.offset + query.limit); index++) {
      signal?.throwIfAborted();
      items.push({ index, sectionIndex: index, label: null, labelTruncated: false, linear: book.sections[index]!.linear !== "no",
        location: { ...base, cfi: cfi(book, index) } });
    }
  } else {
    try { pages = book.getPageList ? await book.getPageList() : book.pageList ?? null; }
    catch (cause) {
      signal?.throwIfAborted();
      throw new AppError("library/content-unavailable", "Page labels could not be loaded", { cause });
    }
    signal?.throwIfAborted();
    let index = 0;
    for (const entry of pageEntries(pages ?? [])) {
      signal?.throwIfAborted();
      const position = index++, label = entry.label ?? "";
      if (query.label !== undefined && label !== query.label) continue;
      const ordinal = total++;
      if (ordinal < query.offset || items.length === query.limit) continue;
      const href = entry.href;
      let sectionIndex: number | null = null;
      if (href && href.length <= 8192 && !/[\u0000-\u001f\u007f]/.test(href)
        && !/^(?:\/\/|(?!kindle:|filepos:)[a-z][a-z\d+.-]*:)/i.test(href.trim()) && !book.isExternal?.(href)) {
        let resolved;
        try { resolved = await book.resolveHref?.(href); }
        catch (cause) { throw new AppError("library/content-unavailable", "Page target could not be resolved", { cause }); }
        signal?.throwIfAborted();
        if (resolved && Number.isSafeInteger(resolved.index) && resolved.index >= 0 && book.sections[resolved.index]) sectionIndex = resolved.index;
      }
      items.push({ index: position, sectionIndex, label: label.slice(0, 300), labelTruncated: label.length > 300,
        linear: sectionIndex === null ? null : book.sections[sectionIndex]!.linear !== "no",
        location: sectionIndex === null || !href ? null : { ...base, href } });
    }
  }
  if (query.offset > total) throw new AppError("library/invalid-query", "Navigation offset exceeds matching targets");
  return { ...base, kind: query.kind, status: query.kind === "pages" && !pages?.length ? "absent" : "available",
    items, total, nextOffset: query.offset + items.length < total ? query.offset + items.length : null };
}

export function listBookNavigationTargets(input: BookNavigationTargetsQuery, signal?: AbortSignal): Promise<BookNavigationTargetsPage> {
  const query = normalizeBookNavigationTargetsQuery(input);
  return withBookContent(query.bookId, query.contentVersion, signal, async ({ book }) => {
    const { contentCFI } = await loadContentNavigation();
    return navigationTargetsInBook(book, query, contentCFI, signal);
  });
}
