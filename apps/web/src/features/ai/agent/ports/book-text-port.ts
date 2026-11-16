import { resourceModelImage } from "../../../../services/model-image";
import type { DomainActor } from "../../../../platform/domain-actor";
/** Agent-specific chapter hrefs and spoiler bounds over shared library reads. */
import { type BookTextPort, type ChapterRef } from "@read-aware/agent";
import { getDigestContentVersion } from "../../../../domain/book-digest";
import { getDigestChapterSource, getBookTextStatus } from "../../../library/lib/book-text-store";
import { createLibraryDomain, getExtractedChapters } from "../../../../domain/library";
import { openBookImageResource } from "../../../../domain/library-book-images";
import { agentResources } from "../../../../services/resources";

export function createBookTextPort(origin: DomainActor = "agent"): BookTextPort {
  const domain = createLibraryDomain(origin);
  const library = domain.queries.books;
  return {
    preparation: {
      history: library.listTextTaskHistory,
      setPriority: domain.commands.books.setTextTaskPriority,
      start: domain.commands.books.prepareText,
      get: library.getTextTask,
      list: library.listTextTasks,
      pause: domain.commands.books.pauseTextTask,
      resume: domain.commands.books.resumeTextTask,
      cancel: domain.commands.books.cancelTextTask,
    },
    getTextState: library.getTextState,
    getSourceVersion: (id, signal) => getDigestContentVersion(id, signal, true),
    getDigestChapter: (id, index, version, signal) => getDigestChapterSource(id, index, version, signal, origin),
    getNavigationToc: library.getNavigationToc,
    listNavigationTargets: library.listNavigationTargets,
    listImages: async ({ throughChapterIndex, ...input }, signal) => {
      const hrefs =
        throughChapterIndex === undefined
          ? undefined
          : (await getExtractedChapters(input.bookId, origin))
              .slice(0, Math.max(0, throughChapterIndex + 1))
              .flatMap((chapter) => chapter.hrefs ?? []);
      return library.listImages(input, signal, hrefs);
    },
    openImageResource: async (ownerKey, { throughChapterIndex, ...input }, signal) => {
      const hrefs =
        throughChapterIndex === undefined
          ? undefined
          : (await getExtractedChapters(input.image.bookId, origin))
              .slice(0, Math.max(0, throughChapterIndex + 1))
              .flatMap((chapter) => chapter.hrefs ?? []);
      return openBookImageResource(
        agentResources(ownerKey, ownerKey.startsWith("book:") ? ownerKey.slice(5) : undefined),
        input,
        signal,
        hrefs,
      );
    },
    readImageInput: async (ownerKey, { throughChapterIndex, ...input }, signal) => {
      const hrefs =
        throughChapterIndex === undefined
          ? undefined
          : (await getExtractedChapters(input.image.bookId, origin))
              .slice(0, Math.max(0, throughChapterIndex + 1))
              .flatMap((chapter) => chapter.hrefs ?? []);
      const owner = agentResources(ownerKey, ownerKey.startsWith("book:") ? ownerKey.slice(5) : undefined);
      const result = await openBookImageResource(owner, input, signal, hrefs);
      if (result.status !== "ready") return result;
      try {
        return {
          status: "ready",
          image: result.image,
          input: await resourceModelImage(owner, result.resource.id, signal),
        };
      } finally {
        await owner.release(result.resource.id);
      }
    },
    listReferences: async ({ throughChapterIndex, ...input }, signal) => {
      const hrefs =
        throughChapterIndex === undefined
          ? undefined
          : (await getExtractedChapters(input.bookId, origin))
              .slice(0, Math.max(0, throughChapterIndex + 1))
              .flatMap((chapter) => chapter.hrefs ?? []);
      return library.listReferences(input, signal, hrefs);
    },
    readReference: async ({ throughChapterIndex, ...input }, signal) => {
      const hrefs =
        throughChapterIndex === undefined
          ? undefined
          : (await getExtractedChapters(input.reference.bookId, origin))
              .slice(0, Math.max(0, throughChapterIndex + 1))
              .flatMap((chapter) => chapter.hrefs ?? []);
      return library.readReference(input, signal, hrefs);
    },
    readRange: async ({ throughChapterIndex, ...input }, signal) => {
      const hrefs =
        throughChapterIndex === undefined
          ? undefined
          : (await getExtractedChapters(input.range.bookId, origin))
              .slice(0, Math.max(0, throughChapterIndex + 1))
              .flatMap((chapter) => chapter.hrefs ?? []);
      return library.readRange(input, signal, hrefs);
    },
    searchLocations: async ({ throughChapterIndex, ...input }, signal) => {
      const hrefs =
        throughChapterIndex === undefined
          ? undefined
          : (await getExtractedChapters(input.bookId, origin))
              .slice(0, Math.max(0, throughChapterIndex + 1))
              .flatMap((chapter) => chapter.hrefs ?? []);
      return library.searchLocations({ ...input, ...(hrefs ? { hrefs } : {}) }, signal);
    },
    getToc: async (bookId) =>
      (await getExtractedChapters(String(bookId), origin)).map<ChapterRef>((chapter, index) => ({
        index,
        title: chapter.title,
        chars: chapter.text.length,
        hrefs: chapter.hrefs,
        blocks: chapter.layout.paragraphs.length,
        unit: chapter.layout.unit,
      })),
    // "没字"与"没抽"要说成两回事——纯图扫描版是终局事实（get_toc 会
    // 触发一次抽取；抽完落定论后这里读到 textless），重试无益。
    getTextStatus: (bookId) => getBookTextStatus(String(bookId)),
    getChapterText: async (bookId, chapterIndex) =>
      (await getExtractedChapters(String(bookId), origin))[chapterIndex]?.text,
    getChapterLayout: async (bookId, chapterIndex) =>
      (await library.getChapterLayout(String(bookId), chapterIndex)) ?? undefined,
    locate: (bookId, target, signal) => library.locateText(String(bookId), target, signal),
    searchText: library.searchText,
  };
}
