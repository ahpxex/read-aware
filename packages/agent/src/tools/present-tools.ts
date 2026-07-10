/**
 * 展示工具（卡片管线的源头）：模型显式决定"把这些书 / 这些词渲染成卡片"。
 * execute 在本地校验并水合 payload，放进 AgentToolResult.details；
 * thread.ts 在 tool_execution_end 处把 details 转成 reference chunk 流给 UI。
 * 给模型的 content 只是简短 ack（presented/skipped）—— 卡片本身用户已看到。
 * 端口之上的本地函数，不走网络，执行近乎即时（UI 侧抑制其活动行）。
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { BookReference, ReferencePayload, WordReference } from "../chunks";
import type { DictionaryEntry } from "../models/dictionary";
import type { RuntimeDeps } from "../ports";

export const PRESENT_TOOL_NAMES = ["present_books", "present_words"] as const;

/** 一叠卡片的条目上限 —— 工具描述与 system prompt 与此保持一致。 */
export const MAX_PRESENTED_ITEMS = 6;

/** present 工具放进 AgentToolResult.details 的形状。 */
export interface ReferenceToolDetails {
  reference: ReferencePayload;
}

/** thread.ts 用的结构守卫：kind 匹配且条目非空才算一份可发射的 payload。 */
export function referenceFromToolDetails(details: unknown): ReferencePayload | undefined {
  if (!details || typeof details !== "object") return undefined;
  const reference = (details as { reference?: unknown }).reference;
  if (!reference || typeof reference !== "object") return undefined;
  const payload = reference as ReferencePayload;
  if (payload.kind === "books" && Array.isArray(payload.books) && payload.books.length > 0) {
    return payload;
  }
  if (payload.kind === "words" && Array.isArray(payload.words) && payload.words.length > 0) {
    return payload;
  }
  return undefined;
}

function ackResult(ack: unknown, reference: ReferencePayload | undefined) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(ack) }],
    details: reference ? ({ reference } satisfies ReferenceToolDetails) : undefined,
  };
}

/** 生词本条目缺完整词条时的最小合成（老数据 / 精简端口实现）。 */
function minimalEntry(term: string, definition: string): DictionaryEntry {
  return {
    headword: term,
    senses: definition ? [{ partOfSpeech: "", definition, examples: [] }] : [],
  };
}

export function buildPresentTools(deps: RuntimeDeps): AgentTool[] {
  const presentBooks: AgentTool = {
    name: "present_books",
    label: "Show books",
    description:
      "Show the reader up to 6 books from their shelf as visual cards inside your reply. Call it when your answer recommends or discusses specific shelf books. The cards render at the point of the call, between your paragraphs — still name the books briefly in prose. Never present the same book twice in one reply.",
    parameters: Type.Object({
      bookIds: Type.Array(
        Type.String({ description: "Book id, as returned by list_books / get_book_overview" }),
        { minItems: 1 },
      ),
    }),
    execute: async (_id, params) => {
      const { bookIds } = params as { bookIds: string[] };
      const unique = [...new Set(bookIds.map((id) => id.trim()).filter(Boolean))];
      const shelf = await deps.library.listBooks();
      const byId = new Map(shelf.map((book) => [book.id as string, book]));
      const found = unique.filter((id) => byId.has(id));
      // 未知 id 走正常 ack 而不是 throw —— 模型看到 skippedUnknown 可自纠
      const skippedUnknown = unique.filter((id) => !byId.has(id));
      const presented = found.slice(0, MAX_PRESENTED_ITEMS);
      const skippedOverflow = found.slice(MAX_PRESENTED_ITEMS);
      const books = presented.map<BookReference>((id) => {
        const book = byId.get(id)!;
        return { bookId: book.id, title: book.title, author: book.author };
      });
      return ackResult(
        { presented, skippedUnknown, skippedOverflow },
        books.length > 0 ? { kind: "books", books } : undefined,
      );
    },
  };

  const presentWords: AgentTool = {
    name: "present_words",
    label: "Show words",
    description:
      "Show up to 6 of the reader's saved vocabulary words as expandable word cards inside your reply. Only for words already in their vocabulary (see get_vocabulary) — to define and show any other word, use lookup_word instead. Never present the same word twice in one reply.",
    parameters: Type.Object({
      terms: Type.Array(Type.String({ description: "A word exactly as saved in the vocabulary" }), {
        minItems: 1,
      }),
    }),
    execute: async (_id, params) => {
      const { terms } = params as { terms: string[] };
      const unique = [...new Set(terms.map((term) => term.trim()).filter(Boolean))];
      const saved = await deps.vocabulary.listVocabulary({});
      const byTerm = new Map(saved.map((entry) => [entry.term.toLowerCase(), entry]));
      const found = unique.filter((term) => byTerm.has(term.toLowerCase()));
      const skippedUnknown = unique.filter((term) => !byTerm.has(term.toLowerCase()));
      const presented = found.slice(0, MAX_PRESENTED_ITEMS);
      const skippedOverflow = found.slice(MAX_PRESENTED_ITEMS);
      const words = presented.map<WordReference>((term) => {
        const entry = byTerm.get(term.toLowerCase())!;
        return {
          term: entry.term,
          language: entry.language,
          entry: entry.entry ?? minimalEntry(entry.term, entry.definition),
          source: "vocabulary",
        };
      });
      return ackResult(
        { presented, skippedUnknown, skippedOverflow },
        words.length > 0 ? { kind: "words", words } : undefined,
      );
    },
  };

  return [presentBooks, presentWords];
}
