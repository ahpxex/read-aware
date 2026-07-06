/**
 * BookTextPort：正文的读端。抽取与持久化归 library 的 book-text-store
 * （导入时抽取；老书首次被问到时懒回填），这里只做会话内缓存 + 检索。
 * 检索用 @read-aware/agent 的共享 searchChapters（多查询 + 词元回退），
 * 与 repl fixture 行为一致；目标态被 SQLite FTS 替换。
 */
import { searchChapters, type BookTextHit, type BookTextPort, type ChapterRef } from "@read-aware/agent";
import type { Id } from "@read-aware/core";
import {
  ensureBookTextExtracted,
  getPersistedBookText,
  type ExtractedChapter,
} from "../../../library/lib/book-text-store";
import { listLibraryBooks } from "../../../library/lib/library-db";

const sessionCache = new Map<string, ExtractedChapter[]>();

async function chaptersOf(bookId: Id): Promise<ExtractedChapter[]> {
  const key = String(bookId);
  const cached = sessionCache.get(key);
  if (cached) return cached;
  const chapters = await ensureBookTextExtracted(key);
  if (chapters.length > 0) sessionCache.set(key, chapters);
  return chapters;
}

/** 已持久化才参与（全书架路径绝不触发批量抽取）。 */
async function persistedChaptersOf(bookId: string): Promise<ExtractedChapter[] | null> {
  const cached = sessionCache.get(bookId);
  if (cached) return cached;
  const chapters = await getPersistedBookText(bookId);
  if (chapters) sessionCache.set(bookId, chapters);
  return chapters;
}

export function createBookTextPort(): BookTextPort {
  return {
    getToc: async (bookId) =>
      (await chaptersOf(bookId)).map<ChapterRef>((chapter, index) => ({
        index,
        title: chapter.title,
        chars: chapter.text.length,
      })),
    getChapterText: async (bookId, chapterIndex) =>
      (await chaptersOf(bookId))[chapterIndex]?.text,
    searchText: async ({ queries, bookId, limit }) => {
      const max = limit ?? 16;
      const results: BookTextHit[] = [];
      if (bookId) {
        const chapters = await chaptersOf(bookId);
        for (const hit of searchChapters(chapters, queries, max)) {
          results.push({ bookId, ...hit });
        }
        return results;
      }
      // 全局线程：检索整个书架里已抽取的书
      for (const book of await listLibraryBooks()) {
        const chapters = await persistedChaptersOf(book.id);
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
