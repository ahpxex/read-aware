import { AppError, normalizeBookRangeQuery, type BookRangePage, type BookRangeQuery } from "@read-aware/core";
import { loadContentNavigation } from "../../reader/lib/foliate-engine";
import { withBookContent } from "./book-content-source";
import { contentSections } from "./book-content-sections";

/** allowedHrefs is host policy, never a caller-supplied field in the public query. */
export function readBookRange(input: BookRangeQuery, signal?: AbortSignal, allowedHrefs?: readonly string[]): Promise<BookRangePage> {
  const query = normalizeBookRangeQuery(input);
  const hrefs = allowedHrefs === undefined ? undefined : [...allowedHrefs];
  return withBookContent(query.range.bookId, query.range.contentVersion, signal, async ({ book }) => {
    const allowed = hrefs === undefined ? undefined : await contentSections(book, hrefs, signal);
    const { readContentRange } = await loadContentNavigation();
    const page = await readContentRange(book, query.range, query, index => {
      if (allowed && !allowed.has(index)) throw new AppError("library/range-forbidden", "Range exceeds the host reading fence");
    }, signal).catch((error: unknown) => {
      // The engine is a static module tree, not the bundled app's class instance.
      if (error && typeof error === "object" && "name" in error && error.name === "ContentRangeError" && "reason" in error) {
        const codes: Record<string, string> = { "not-found": "library/range-not-found", unsupported: "library/range-unsupported",
          ambiguous: "library/range-ambiguous", "invalid-offset": "library/invalid-range" };
        const code = typeof error.reason === "string" ? codes[error.reason] : undefined;
        if (code) throw new AppError(code, "Content range resolution failed", { cause: error });
      }
      throw error;
    });
    return { range: { ...query.range, cfi: page.cfi }, sectionIndex: page.sectionIndex, text: page.text,
      offset: query.offset, totalLength: page.totalLength, nextOffset: page.nextOffset, context: page.context };
  });
}
