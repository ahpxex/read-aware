/**
 * 图谱养护的单次节拍：分类（若还没有）→ 定位读者边界 → 按预算补齐欠账
 * 章节的纪要。两个触发源共用这一份逻辑：
 *   - 宿主的空闲维护循环（apps/web maintenance：最近打开的书，5 分钟节拍）
 *   - 书线程的轮后管道（聊哪本书，哪本书的图就优先追平——存量用户换新
 *     agent 后发的第一条消息起，图谱随对话逐轮补建，不必等空闲挂机）
 * 边界解析优先级：调用方给的 href（阅读器游标）→ 书的进度 chapterHref
 * （聊天时阅读器未开）→ 已读完的书全书。都没有则本节拍空转。
 */
import type { Api, Model } from "@earendil-works/pi-ai";
import type { Id } from "@read-aware/core";
import type { CompleteFn } from "../models/complete";
import type { RuntimeDeps } from "../ports";
import { findChapterByHref } from "../text/chapter-lookup";
import { digestMissingChapters } from "./chapter-digest";
import { classifyNarrativity } from "./narrativity";

export interface DigestBookTickInput {
  deps: Pick<RuntimeDeps, "library" | "bookText" | "bookMemory">;
  complete: CompleteFn;
  model: Model<Api>;
  bookId: Id;
  /** 读者当前所在章的 href；缺省回退到书的进度 chapterHref。 */
  throughChapterHref?: string;
  /** 本节拍的章节预算。 */
  maxChapters?: number;
  /** 批内并发度（见 digestMissingChapters.concurrency）。 */
  concurrency?: number;
}

/**
 * 叙事性分类（图谱节拍的前置步骤）：未分类的书先分类并经 LibraryPort 落成
 * 事件；失败返回 undefined（本节拍按 narrative 保守提炼，下个节拍重试）。
 */
async function ensureNarrativity(
  input: DigestBookTickInput,
): Promise<"narrative" | "expository" | undefined> {
  const book = await input.deps.library.getBook(input.bookId);
  if (!book) return undefined;
  if (book.narrativity) return book.narrativity;
  const toc = await input.deps.bookText.getToc(input.bookId).catch(() => undefined);
  if (!toc?.length) return undefined;
  // 正文样本：跳过版权页等空转小节，取第一段像样的实文。
  let sampleText = "";
  for (let index = 0; index < Math.min(toc.length, 8) && sampleText.length < 600; index++) {
    const text = await input.deps.bookText
      .getChapterText(input.bookId, index)
      .catch(() => undefined);
    if (text && text.trim().length > sampleText.length) sampleText = text.trim();
  }
  if (!sampleText) return undefined;
  const narrativity = await classifyNarrativity({
    complete: input.complete,
    model: input.model,
    title: book.title,
    author: book.author,
    toc,
    sampleText,
  });
  if (!narrativity) return undefined;
  try {
    await input.deps.library.setBookNarrativity(input.bookId, narrativity);
  } catch {
    return undefined;
  }
  return narrativity;
}

/** 跑一个图谱节拍；返回本次实际提炼的章数（0 = 账已清或边界未知）。 */
export async function digestBookTick(input: DigestBookTickInput): Promise<number> {
  const deps = input.deps;
  const book = await deps.library.getBook(input.bookId);
  if (!book) return 0;
  // 边界：显式 href → 书的进度 chapterHref（聊天时阅读器未开）→ 读完全书。
  const href =
    input.throughChapterHref ??
    (await deps.library.getBookStats(input.bookId).catch(() => undefined))?.chapterHref;
  let beforeChapterIndex: number | undefined;
  if (href) {
    const toc = await deps.bookText.getToc(input.bookId).catch(() => undefined);
    const chapter = toc ? findChapterByHref(toc, href) : undefined;
    beforeChapterIndex = chapter?.index;
  }
  if (beforeChapterIndex === undefined) {
    if (book.status !== "finished") return 0;
    const toc = await deps.bookText.getToc(input.bookId).catch(() => undefined);
    beforeChapterIndex = toc?.length ?? 0;
  }
  // 纪要口径跟着书的叙事性走。未分类的书先分类；分类失败本节拍按
  // narrative 保守提炼——它的产物起码无害，分类落库后口径不符的行会被重算。
  const narrativity = book.narrativity ?? (await ensureNarrativity(input));
  return digestMissingChapters({
    bookText: deps.bookText,
    bookMemory: deps.bookMemory,
    complete: input.complete,
    model: input.model,
    bookId: input.bookId,
    beforeChapterIndex,
    maxChapters: input.maxChapters,
    flavor: narrativity ?? "narrative",
    concurrency: input.concurrency,
  });
}

export interface DigestBookCatchUpInput extends Omit<DigestBookTickInput, "maxChapters"> {
  /** 每轮循环的批大小；缺省 = concurrency（一轮一批）。 */
  batchChapters?: number;
  /** 取消信号（关书/退出时宿主中止；已落库的章节无损保留）。 */
  signal?: AbortSignal;
  /** 每批完成后的进度回调（累计已提炼章数）。 */
  onProgress?: (digestedSoFar: number) => void;
}

/**
 * 持续追平：只要读者还在这本书里（signal 未中止），并行批次一轮接一轮
 * 跑到欠账清零。这是存量进度的根治路径——打开书即开始建图，不等空闲
 * 节拍也不等聊天；每章成功即落库，中断只丢在飞的那一批。
 * 返回本次总共提炼的章数。
 */
export async function digestBookCatchUp(input: DigestBookCatchUpInput): Promise<number> {
  const concurrency = Math.max(1, Math.floor(input.concurrency ?? 1));
  const batch = Math.max(1, Math.floor(input.batchChapters ?? concurrency));
  let total = 0;
  for (;;) {
    if (input.signal?.aborted) break;
    const digested = await digestBookTick({ ...input, maxChapters: batch });
    if (digested === 0) break;
    total += digested;
    input.onProgress?.(total);
  }
  return total;
}
