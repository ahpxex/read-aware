import type { Id } from "@read-aware/core";
import { getAgentRuntime } from "./agent-runtime";
import { createLogger } from "../../../platform/logger";
import { listLibraryBooks } from "../../library/lib/library-db";

const log = createLogger("agent");

const CHECK_INTERVAL_MS = 5 * 60_000;
const IDLE_TIMEOUT_MS = 30_000;
/** 每个空闲节拍最多提炼的章节数——成本按节拍分摊，绝不挤占前台。 */
const DIGEST_CHAPTERS_PER_TICK = 2;

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
