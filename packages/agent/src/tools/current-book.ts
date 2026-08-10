/**
 * bookId 参数的统一解析。模型时不时会传 "current"/"this" 这类字面量
 * 而不是省略参数——语义明确，宽容处理成"当前书"，别报错烧一轮重试。
 */
import type { Id } from "@read-aware/core";
import type { ThreadScope } from "../thread-scope";

const CURRENT_BOOK_ALIASES = new Set([
  "current",
  "current-book",
  "current_book",
  "this",
  "this-book",
  "this_book",
]);

/** "current" 等占位值归一为 undefined（走默认书）；其余原样返回。 */
export function normalizeBookIdParam(raw?: string): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  return CURRENT_BOOK_ALIASES.has(trimmed.toLowerCase()) ? undefined : trimmed;
}

/** 书线程默认当前书；全局线程必须显式给出真实 bookId。 */
export function resolveBookId(scope: ThreadScope, raw?: string): Id {
  const target = (normalizeBookIdParam(raw) ??
    (scope.kind === "book" ? scope.bookId : undefined)) as Id | undefined;
  if (!target) throw new Error("bookId is required in the global thread");
  return target;
}
