/**
 * 展示工具（卡片管线的源头）：模型显式决定"把这些书 / 这些词渲染成卡片"。
 * execute 在本地校验并水合 payload，放进 AgentToolResult.details；
 * thread.ts 在 tool_execution_end 处把 details 转成 reference chunk 流给 UI。
 * 给模型的 content 只是简短 ack（presented/skipped）—— 卡片本身用户已看到。
 * 端口之上的本地函数，不走网络，执行近乎即时（UI 侧抑制其活动行）。
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { BookReference, ReferencePayload } from "../chunks";
import type { RuntimeDeps } from "../ports";

export const PRESENT_TOOL_NAMES = ["present_books"] as const;

/**
 * 一叠卡片的硬性兜底（UI 折叠成 3 张 + 展开行，多不致噪）。推荐类回答该
 * 克制（提示词管），但"书架上有哪些书"这类列举理应整架出卡。
 */
export const MAX_PRESENTED_ITEMS = 24;

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

export function buildPresentTools(deps: RuntimeDeps): AgentTool[] {
  const presentBooks: AgentTool = {
    name: "present_books",
    label: "Show books",
    description:
      "Show the reader books from their shelf as visual cards inside your reply. Use it whenever your answer lists, recommends, or discusses shelf books — including \"what's on my shelf\", where you present the whole shelf in one call. Get ids from a fresh list_books call in this conversation (ids remembered from earlier go stale). The cards render at the point of the call, between your paragraphs — keep prose mentions brief; don't repeat the list as text. Never present the same book twice in one reply.",
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

  return [presentBooks];
}
