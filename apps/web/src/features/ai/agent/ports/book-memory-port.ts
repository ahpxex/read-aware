/**
 * BookMemoryPort over SQLite（chapter_digests 投影）。写路径事件先行：
 * saveDigest 提交 book.chapterDigested，apply.rs 在同一事务里物化投影行——
 * LLM 产物不可确定性重算，入事件流才可跨设备同步、可重放。
 * 读路径走 chapter_digests_list 命令；browser（非 Tauri）下静默空集，
 * 与其他投影读端的降级姿态一致。
 */
import { invoke } from "../../../../platform/ipc";
import { BookDigestQueue, type BookMemoryPort } from "@read-aware/agent";
import { inspectBookDigest, saveBookDigest } from "../../../../domain/book-digest";
import { isTauri } from "../../../../platform/environment";
import { decodeChapterDigestRows } from "./chapter-digest-row";

const queue = new BookDigestQueue();

export function createBookMemoryPort(): BookMemoryPort {
  return {
    runExclusive: (bookId, work, signal) => queue.run(bookId, work, signal),
    listDigests: async (bookId) => {
      if (!isTauri()) return [];
      const rows = await invoke<unknown>("chapter_digests_list", {
        bookId: String(bookId),
      });
      return decodeChapterDigestRows(rows, bookId);
    },
    inspectDigest: inspectBookDigest,
    saveDigest: saveBookDigest,
  };
}
