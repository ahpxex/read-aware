/**
 * BookTextPort：正文抽取的产品侧 v1 —— 惰性抽取 + 会话内缓存。
 * 第一次被工具问到某本书时，从 blob store 取原文件、foliate 离屏解析出
 * 章节纯文本（同 lab 的实现）。目标态是导入时抽取并持久化
 * （docs/agent-architecture.md §11.5），这里的缓存只活在会话内。
 */
import type { BookTextPort, ChapterRef } from "@read-aware/agent";
import type { Id } from "@read-aware/core";
import { getStoredBookBlob } from "../../../library/lib/library-db";
import { makeFoliateBook } from "../../../reader/lib/foliate-engine";

interface ExtractedChapter {
  title?: string;
  text: string;
}

type FoliateSectionLike = {
  createDocument?: () => Promise<Document> | Document;
  linear?: string;
};

const cache = new Map<string, ExtractedChapter[]>();
const inflight = new Map<string, Promise<ExtractedChapter[]>>();

async function extract(bookId: string): Promise<ExtractedChapter[]> {
  const blob = await getStoredBookBlob(bookId);
  if (!blob) return [];
  const book = await makeFoliateBook(new File([blob], `${bookId}.book`));
  const tocLabels = (book.toc ?? [])
    .map((item) => item.label?.trim())
    .filter(Boolean) as string[];
  const chapters: ExtractedChapter[] = [];
  for (const section of (book.sections ?? []) as FoliateSectionLike[]) {
    if (section.linear === "no" || !section.createDocument) continue;
    try {
      const doc = await section.createDocument();
      const text = (doc.body?.textContent ?? "").replace(/\s+/g, " ").trim();
      if (text.length < 40) continue;
      chapters.push({ title: tocLabels[chapters.length], text });
    } catch {
      // 单个 section 失败不拖垮整本书
    }
  }
  return chapters;
}

async function ensureChapters(bookId: Id): Promise<ExtractedChapter[]> {
  const key = String(bookId);
  const cached = cache.get(key);
  if (cached) return cached;
  let pending = inflight.get(key);
  if (!pending) {
    pending = extract(key)
      .then((chapters) => {
        cache.set(key, chapters);
        return chapters;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return pending;
}

export function createBookTextPort(): BookTextPort {
  return {
    getToc: async (bookId) =>
      (await ensureChapters(bookId)).map<ChapterRef>((chapter, index) => ({
        index,
        title: chapter.title,
      })),
    getChapterText: async (bookId, chapterIndex) =>
      (await ensureChapters(bookId))[chapterIndex]?.text,
    searchText: async ({ query, bookId, limit }) => {
      // v1 只支持单书检索（全书架检索要等抽取结果持久化，否则会全量解析书架）
      if (!bookId) return [];
      const chapters = await ensureChapters(bookId);
      const results: Array<{
        bookId: Id;
        chapterIndex: number;
        chapterTitle?: string;
        snippet: string;
      }> = [];
      chapters.forEach((chapter, index) => {
        const at = chapter.text.indexOf(query);
        if (at === -1) return;
        results.push({
          bookId,
          chapterIndex: index,
          chapterTitle: chapter.title,
          snippet: chapter.text.slice(Math.max(0, at - 60), at + query.length + 60),
        });
      });
      return results.slice(0, limit ?? 8);
    },
  };
}
