import type { BookLocationSearch, BookLocationSearchPage, BookNavigationToc } from "@read-aware/core";
import { loadContentNavigation } from "../../reader/lib/foliate-engine";
import { withBookContent } from "./book-content-source";
import { navigationToc, searchLocationsInBook, validateLocationSearch } from "./book-location-search";

export function getBookNavigationToc(bookId: string, signal?: AbortSignal): Promise<BookNavigationToc> {
  return withBookContent(bookId, undefined, signal, ({ book, contentVersion }) => navigationToc(book, bookId, contentVersion, signal));
}

export function searchBookLocations(input: BookLocationSearch, signal?: AbortSignal): Promise<BookLocationSearchPage> {
  validateLocationSearch(input);
  return withBookContent(input.bookId, input.contentVersion, signal, async ({ book, contentVersion }) => {
    const { searchContentSection } = await loadContentNavigation();
    return searchLocationsInBook(book, contentVersion, input, searchContentSection, signal);
  });
}
