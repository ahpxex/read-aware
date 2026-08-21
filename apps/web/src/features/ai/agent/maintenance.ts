import type { Id } from "@read-aware/core";
import { getAgentRuntime } from "./agent-runtime";
import { createLogger } from "../../../platform/logger";
import { listLibraryBooks } from "../../library/lib/library-db";

const log = createLogger("agent");

const CHECK_INTERVAL_MS = 5 * 60_000;
const IDLE_TIMEOUT_MS = 30_000;
/** 每个空闲节拍最多提炼的章节数——成本按节拍分摊，绝不挤占前台。 */
const DIGEST_CHAPTERS_PER_TICK = 2;
/** 阅读会话追平的并发度（fast 档 LLM 滑动窗口，网络绑定、不占主线程）。
 *  实测（卡拉马佐夫 30 章欠账，DeepSeek fast）：串行 78s → 并发 6 约 32s；
 *  再高仍有收益但要迁就 BYO key 里配额最紧的 provider。 */
const CATCH_UP_CONCURRENCY = 6;

const catchUpInFlight = new Set<string>();

/**
 * 阅读会话触发的图谱追平：打开一本书即并行补建它的纪要欠账，跑到清零。
 * 存量用户（读了半本、图是空的）从开卷那一刻起建图，不等 5 分钟空闲
 * 节拍、不等聊天。每章成功即落成事件，进程中断无损，重跑续账。
 * 同书去重；追平后的再次调用是一次纯读空转。
 */
export function catchUpBookGraph(bookId: string, throughChapterHref?: string): void {
  const runtime = getAgentRuntime();
  if (!runtime || catchUpInFlight.has(bookId)) return;
  catchUpInFlight.add(bookId);
  void runtime
    .digestBookCatchUp(bookId as Id, {
      throughChapterHref,
      concurrency: CATCH_UP_CONCURRENCY,
    })
    .then((digested) => {
      if (digested > 0) log.info(`book graph caught up: ${digested} chapters`, { bookId });
    })
    .catch((error) => log.warn("book graph catch-up failed", error))
    .finally(() => catchUpInFlight.delete(bookId));
}

function scheduleIdle(work: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(work, { timeout: IDLE_TIMEOUT_MS });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(work, 2_000);
  return () => window.clearTimeout(id);
}

/** Start low-priority memory maintenance for the lifetime of the desktop app. */
export function startAgentMaintenance(): () => void {
  let stopped = false;
  let cancelIdle: (() => void) | null = null;

  const hidden = () => document.visibilityState === "hidden";
  const run = async () => {
    cancelIdle = null;
    if (stopped || hidden()) return;
    try {
      await getAgentRuntime()?.consolidateIfNeeded();
    } catch (error) {
      // Maintenance is retried on the next idle tick and must never disturb chat.
      log.warn("memory consolidation failed", error);
    }
    if (stopped || hidden()) return;
    try {
      // 章节读毕提炼（book_memory 投影）：只碰最近打开的那本书——它的
      // 抽取缓存是热的；其余书轮到被打开时自然补齐。
      const runtime = getAgentRuntime();
      if (runtime) {
        const [candidate] = (await listLibraryBooks())
          .filter((book) => book.lastOpenedAt !== null)
          .sort((a, b) => (b.lastOpenedAt ?? "").localeCompare(a.lastOpenedAt ?? ""));
        if (candidate) {
          await runtime.digestBook(candidate.id as Id, {
            throughChapterHref: candidate.progress?.href ?? undefined,
            maxChapters: DIGEST_CHAPTERS_PER_TICK,
          });
        }
      }
    } catch (error) {
      log.warn("chapter digest pass failed", error);
    }
  };

  const queue = () => {
    if (stopped || cancelIdle || document.visibilityState === "hidden") return;
    cancelIdle = scheduleIdle(() => void run());
  };

  queue();
  const interval = window.setInterval(queue, CHECK_INTERVAL_MS);
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") queue();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    stopped = true;
    cancelIdle?.();
    window.clearInterval(interval);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
