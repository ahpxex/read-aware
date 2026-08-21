/**
 * BookTextPort：正文的读端。章节抽取与会话缓存归共享领域层
 * （domain/books：getExtractedChapters / getPersistedChapters —— 与插件面的
 * getToc/getChapterText 同一份缓存）；这里保留 agent 特有的部分：hrefs
 * 反查扩展与多查询检索。检索用 @read-aware/agent 的共享 searchChapters
 * （多查询 + 词元回退），目标态被 SQLite FTS 替换。
 */
import { searchChapters, type BookTextHit, type BookTextPort, type ChapterRef } from "@read-aware/agent";
import type { Id } from "@read-aware/core";
import { getExtractedChapters, getPersistedChapters } from "../../../../domain";
import { getBookTextStatus } from "../../../library/lib/book-text-store";
import { listLibraryBooks } from "../../../library/lib/library-db";

export function createBookTextPort(): BookTextPort {
  return {
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
    searchText: async ({ queries, bookId, throughChapterIndex, limit }) => {
      const max = limit ?? 16;
      const results: BookTextHit[] = [];
      if (bookId) {
        const extracted = await getExtractedChapters(String(bookId));
        const chapters =
          throughChapterIndex === undefined
            ? extracted
            : extracted.slice(0, Math.max(0, Math.floor(throughChapterIndex) + 1));
        for (const hit of searchChapters(chapters, queries, max)) {
          results.push({ bookId, ...hit });
        }
        return results;
      }
      if (throughChapterIndex !== undefined) {
        throw new Error("throughChapterIndex requires a specific book");
      }
      // 全局线程：检索整个书架里已抽取的书（绝不触发批量抽取）
      for (const book of await listLibraryBooks()) {
        const chapters = await getPersistedChapters(book.id);
        if (!chapters) continue;
        for (const hit of searchChapters(chapters, queries, max)) {
          results.push({ bookId: book.id as Id, ...hit });
        }
        if (results.length >= max) break;
      }
      return results.slice(0, max);
    },
  };
}
