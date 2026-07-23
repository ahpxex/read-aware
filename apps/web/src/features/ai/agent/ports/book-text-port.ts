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
    getChapterText: async (bookId, chapterIndex) =>
      (await getExtractedChapters(String(bookId)))[chapterIndex]?.text,
    searchText: async ({ queries, bookId, limit }) => {
      const max = limit ?? 16;
      const results: BookTextHit[] = [];
      if (bookId) {
        const chapters = await getExtractedChapters(String(bookId));
        for (const hit of searchChapters(chapters, queries, max)) {
          results.push({ bookId, ...hit });
        }
        return results;
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
