/** Agent-specific chapter hrefs and spoiler bounds over shared library reads. */
import { type BookTextPort, type ChapterRef } from "@read-aware/agent";
import { getExtractedChapters } from "../../../../domain";
import { getBookTextStatus } from "../../../library/lib/book-text-store";
import { createLibraryDomain } from "../../../../domain/library";

export function createBookTextPort(): BookTextPort {
  const domain = createLibraryDomain("agent");
  const library = domain.queries.books;
  return {
    preparation: { start: domain.commands.books.prepareText, get: library.getTextTask, list: library.listTextTasks, cancel: domain.commands.books.cancelTextTask },
    getTextState: library.getTextState,
    getNavigationToc: library.getNavigationToc,
    searchLocations: async ({ throughChapterIndex, ...input }, signal) => {
      const hrefs = throughChapterIndex === undefined ? undefined : (await getExtractedChapters(input.bookId))
        .slice(0, Math.max(0, throughChapterIndex + 1)).flatMap(chapter => chapter.hrefs ?? []);
      return library.searchLocations({ ...input, ...(hrefs ? { hrefs } : {}) }, signal);
    },
    getToc: async (bookId) =>
      (await getExtractedChapters(String(bookId))).map<ChapterRef>((chapter, index) => ({
        index,
        title: chapter.title,
        chars: chapter.text.length,
        hrefs: chapter.hrefs,
      })),
    // "没字"与"没抽"要说成两回事——纯图扫描版是终局事实（get_toc 会
    // 触发一次抽取；抽完落定论后这里读到 textless），重试无益。
    getTextStatus: (bookId) => getBookTextStatus(String(bookId)),
    getChapterText: async (bookId, chapterIndex) =>
      (await getExtractedChapters(String(bookId)))[chapterIndex]?.text,
    searchText: library.searchText,
  };
}
