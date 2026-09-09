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
import { AppError, type Id } from "@read-aware/core";
import type { CompleteFn } from "../models/complete";
import type { RuntimeDeps } from "../ports";
import { findChapterByHref } from "../text/chapter-lookup";
import { digestMissingChapters, digestExecutionBudget, unavailableDigestReport, type DigestReport } from "./digest-run";
import { classifyNarrativity } from "./narrativity";

export interface DigestBookTickInput {
  deps: Pick<RuntimeDeps, "library" | "bookText" | "bookMemory" | "log">;
  complete: CompleteFn;
  model: Model<Api>;
  bookId: Id;
  /** 读者当前所在章的 href；缺省回退到书的进度 chapterHref。 */
  throughChapterHref?: string;
  /** 本节拍的章节预算。 */
  maxChapters?: number;
  /** 批内并发度（见 digestMissingChapters.concurrency）。 */
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (digested: number) => void;
  rebuild?: boolean;
  targets?: readonly number[];
  onStarted?: () => void;
  onPlan?: (chapters: number[]) => void;
  onChapterCommitted?: (chapter: number) => void;
  onReport?: (report: DigestReport) => void;
  /** Trusted host policy, resolved after entering the shared book queue. */
  resolveBoundary?: () => Promise<number | undefined>;
  checkChapter?: (chapter: number) => Promise<void>;
}

/**
 * 叙事性分类（图谱节拍的前置步骤）：未分类的书先分类并经 LibraryPort 落成
 * 事件；失败返回 undefined（本节拍按 narrative 保守提炼，下个节拍重试）。
 */
async function ensureNarrativity(
  input: DigestBookTickInput,
  beforeChapterIndex: number,
): Promise<"narrative" | "expository" | undefined> {
  const book = await input.deps.library.getBook(input.bookId);
  input.signal?.throwIfAborted();
  if (!book) return undefined;
  if (book.narrativity) return book.narrativity;
  const toc = await input.deps.bookText.getToc(input.bookId).catch((error) => {
    input.deps.log?.warn("narrativity sampling: toc unavailable", error);
    return undefined;
  });
  if (!toc?.length) return undefined;
  // 正文样本：跳过版权页等空转小节，取第一段像样的实文。
  let sampleText = "";
  for (let index = 0; index < Math.min(toc.length, 8, beforeChapterIndex) && sampleText.length < 600; index++) {
    input.signal?.throwIfAborted();
    await input.checkChapter?.(index);
    const text = await input.deps.bookText
      .getChapterText(input.bookId, index)
      .catch((error) => {
        input.deps.log?.warn("narrativity sampling: chapter text unavailable", error);
        return undefined;
      });
    if (text && text.trim().length > sampleText.length) sampleText = text.trim();
    await input.checkChapter?.(index);
  }
  input.signal?.throwIfAborted();
  if (!sampleText) return undefined;
  const narrativity = await classifyNarrativity({
    log: input.deps.log,
    complete: (model, context) => input.complete(model, context, { signal: input.signal }),
    model: input.model,
    title: book.title,
    author: book.author,
    toc,
    sampleText,
  });
  input.signal?.throwIfAborted();
  if (!narrativity) {
    input.deps.log?.warn("narrativity classification incomplete; keeping it pending");
    return undefined;
  }
  try {
    return await input.deps.library.classifyBookIfUnclassified(input.bookId, narrativity, input.signal);
  } catch (error) {
    input.deps.log?.warn("recording narrativity failed; will reclassify next tick", error);
    return undefined;
  }
}

/** A report distinguishes completed work, remaining chapters and unknown boundaries. */
export async function digestBookTick(input: DigestBookTickInput): Promise<DigestReport> {
  const request = { ...input, targets: input.targets && [...input.targets] };
  if (request.targets?.some(index => !Number.isSafeInteger(index) || index < 0)) throw new AppError("memory/invalid-input", "Invalid digest targets");
  digestExecutionBudget(request);
  return request.deps.bookMemory.runExclusive(request.bookId, () => digestBookTickExclusive(request), request.signal);
}

async function digestBookTickExclusive(input: DigestBookTickInput): Promise<DigestReport> {
  const { max } = digestExecutionBudget(input);
  const deps = input.deps;
  input.signal?.throwIfAborted();
  input.onStarted?.();
  const book = await deps.library.getBook(input.bookId);
  input.signal?.throwIfAborted();
  if (!book) throw new AppError("reader/book-not-found", "Book not found");
  // 边界：显式 href → 书的进度 chapterHref（聊天时阅读器未开）→ 读完全书。
  const href = input.resolveBoundary ? undefined :
    input.throughChapterHref ??
    (await deps.library.getBookStats(input.bookId))?.chapterHref;
  input.signal?.throwIfAborted();
  let beforeChapterIndex = await input.resolveBoundary?.();
  input.signal?.throwIfAborted();
  if (input.resolveBoundary && beforeChapterIndex === undefined) return unavailableDigestReport("boundary-unknown");
  if (href) {
    const toc = await deps.bookText.getToc(input.bookId);
    input.signal?.throwIfAborted();
    const chapter = toc ? findChapterByHref(toc, href) : undefined;
    beforeChapterIndex = chapter?.index;
  }
  if (beforeChapterIndex === undefined) {
    if (book.status !== "finished") return unavailableDigestReport("boundary-unknown");
    const toc = await deps.bookText.getToc(input.bookId);
    input.signal?.throwIfAborted();
    if (!toc.length) return unavailableDigestReport("no-toc");
    beforeChapterIndex = toc.length;
  }
  // 纪要口径跟着书的叙事性走。未分类的书先分类；分类失败本节拍按
  // narrative 保守提炼——它的产物起码无害，分类落库后口径不符的行会被重算。
  const narrativity = book.narrativity ?? (max === 0 ? undefined : await ensureNarrativity(input, beforeChapterIndex));
  input.signal?.throwIfAborted();
  const report = await digestMissingChapters({
    bookText: deps.bookText,
    bookMemory: deps.bookMemory,
    complete: input.complete,
    model: input.model,
    bookId: input.bookId,
    beforeChapterIndex,
    maxChapters: input.maxChapters,
    flavor: narrativity ?? "narrative",
    concurrency: input.concurrency,
    signal: input.signal,
    log: deps.log,
    onProgress: input.onProgress,
    rebuild: input.rebuild, targets: input.targets, onPlan: input.onPlan, onChapterCommitted: input.onChapterCommitted,
    onReport: input.onReport, checkChapter: input.checkChapter,
  });
  if (!narrativity) { report.status = "partial"; report.reason = "classification-pending"; }
  return report;
}

export interface DigestBookCatchUpInput extends Omit<DigestBookTickInput, "maxChapters"> {
  /** 取消信号（关书/退出时宿主中止；已落库的章节无损保留）。 */
  signal?: AbortSignal;
  /** 每章保存后的进度回调（本次累计已提炼章数）。 */
  onProgress?: (digestedSoFar: number) => void;
}

/**
 * One finite pass over the sampled boundary. Empty/failing chapters stay pending,
 * but cannot starve later chapters or cause an unbounded retry loop in this run.
 */
export async function digestBookCatchUp(input: DigestBookCatchUpInput): Promise<DigestReport> {
  return digestBookTick({ ...input, maxChapters: Number.MAX_SAFE_INTEGER });
}
