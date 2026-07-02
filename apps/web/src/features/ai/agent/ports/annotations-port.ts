/** AnnotationsPort over annotation-db：读高亮/笔记/提问痕迹，写 ask-note。 */
import { getDefaultStore } from "jotai";
import type { AnnotationRecord, AnnotationsPort } from "@read-aware/agent";
import type { Id } from "@read-aware/core";
import { listAnnotations, saveAnnotation } from "../../../annotations/lib/annotation-db";
import type { Annotation, Ask } from "../../../annotations/lib/annotation-types";
import { annotationsRevisionAtom } from "../../../annotations/state/annotations-revision";

function toRecord(annotation: Annotation): AnnotationRecord {
  return {
    id: annotation.id,
    bookId: annotation.bookId as Id,
    kind: annotation.type,
    text: annotation.text,
    content: annotation.type === "note" ? annotation.content : undefined,
    chapter: annotation.chapterHref ?? undefined,
    createdAt: annotation.createdAt,
  };
}

export function createAnnotationsPort(): AnnotationsPort {
  return {
    listAnnotations: async (filter) =>
      (
        await listAnnotations({
          bookId: filter?.bookId ? String(filter.bookId) : undefined,
          searchQuery: filter?.query,
        })
      ).map(toRecord),
    recordAsk: async ({ bookId, question, anchor, chapter }) => {
      const now = new Date().toISOString();
      const ask: Ask = {
        id: crypto.randomUUID(),
        bookId: String(bookId),
        type: "ask",
        cfiRange: anchor ?? null,
        chapterHref: chapter ?? null,
        text: question,
        createdAt: now,
        updatedAt: now,
      };
      await saveAnnotation(ask);
      // 标注列表靠 revision 计数保活（reader 内外的列表都会重读）
      const store = getDefaultStore();
      store.set(annotationsRevisionAtom, store.get(annotationsRevisionAtom) + 1);
    },
  };
}
