import { useEffect, useMemo, useState } from "react";
import type { BookTextSnapshot } from "@read-aware/core";
import { createLibraryDomain } from "../../../domain/library";
import { onAppEvent } from "../../../platform/app-events";
import { createLogger } from "../../../platform/logger";

const log = createLogger("reading-mode-support");

/**
 * Whether a book can be read in a text-unit mode (sentence by sentence).
 * `pending` is not `unsupported`: the answer is on its way, and until it
 * arrives the mode a book was left in is kept, not switched off.
 */
export type ReadingModeSupport = "supported" | "unsupported" | "pending";

/**
 * A text-unit mode steps through a book's running text, so it needs text.
 *
 * - A reflowable book has it.
 * - A PDF has it when its pages carry a text layer. Whether any does is the
 *   library's finding (`BookTextSnapshot.text`): a PDF found to be text-less —
 *   a scan — cannot host the mode, one with text can, and one not examined
 *   yet is given the benefit of the doubt (a step simply stops on a page
 *   that turns out to have none).
 * - Other fixed-layout books (comics, pre-paginated EPUB) are not offered it.
 *
 * `isFixedLayout` is the engine's finding for the open book; a PDF is known
 * by its format before that.
 */
export function useReadingModeSupport(
  bookId: string,
  format: string | null | undefined,
  isFixedLayout: boolean,
): ReadingModeSupport {
  const library = useMemo(() => createLibraryDomain("user"), []);
  const pdf = format === "pdf";
  const [found, setFound] = useState<{ bookId: string; text: BookTextSnapshot["text"] } | null>(null);
  useEffect(() => {
    if (!pdf) return;
    let current = true;
    const read = () =>
      library.queries.books.getTextState(bookId).then(
        (snapshot) => {
          if (current) setFound({ bookId, text: snapshot.text });
        },
        (error: unknown) => {
          // Not knowing is not a finding of no text: the mode stays on offer.
          log.warn("Could not read whether the book has text", error);
          if (current) setFound({ bookId, text: "unknown" });
        },
      );
    void read();
    const off = onAppEvent("book-text-changed", (event) => {
      if (event.bookId === bookId) void read();
    });
    return () => {
      current = false;
      off();
    };
  }, [bookId, library, pdf]);
  if (!pdf) return isFixedLayout ? "unsupported" : "supported";
  const text = found?.bookId === bookId ? found.text : null;
  return text === null ? "pending" : text === "textless" ? "unsupported" : "supported";
}
