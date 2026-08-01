import type { ReaderPort } from "@read-aware/agent";
import { getDefaultStore } from "jotai";
import { requestPluginReaderNav } from "../../../plugins/state/reader-nav";
import { openBookRequestAtom } from "../../state/chat-intent";

/** Agent and plugin navigation share the same ambient reader dispatch path. */
export function createReaderPort(): ReaderPort {
  return {
    openBook: (bookId) => {
      getDefaultStore().set(openBookRequestAtom, {
        id: crypto.randomUUID(),
        bookId: String(bookId),
      });
    },
    goTo: ({ bookId, anchor, chapterHref }) => {
      requestPluginReaderNav({
        bookId: bookId ? String(bookId) : undefined,
        cfi: anchor,
        href: chapterHref,
      });
    },
  };
}
