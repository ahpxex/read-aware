import { AppError, type BookTextTaskSnapshot } from "@read-aware/core";
import type { BookTextPort } from "../ports";

/** Deterministic tool fixture; no real parser or persistence is simulated. */
export function createMemoryTextPreparation(chapters: ReadonlyMap<string, readonly { text: string }[]>): NonNullable<BookTextPort["preparation"]> {
  const tasks = new Map<string, BookTextTaskSnapshot>();
  const get = (bookId: string, taskId: string) => {
    const task = tasks.get(taskId);
    if (!task || task.bookId !== bookId) throw new AppError("library/text-task-not-found", "Unknown fixture task");
    return structuredClone(task);
  };
  return {
    start: async (bookId, options) => {
      const text = chapters.get(bookId);
      const now = new Date().toISOString();
      const task: BookTextTaskSnapshot = { taskId: crypto.randomUUID(), bookId, mode: options?.rebuild ? "rebuild" : "prepare",
        status: text ? "completed" : "failed", revision: 1, createdAt: now, updatedAt: now,
        textState: { bookId, contentVersion: "fixture", status: text ? "ready" : "unprepared", text: text ? text.some(c => c.text.length) ? "available" : "textless" : "unknown", chapterCount: text?.length ?? 0, progress: null },
        ...(!text ? { errorCode: "library/content-unavailable" } : {}),
      };
      tasks.set(task.taskId, task); return structuredClone(task);
    },
    get: async (bookId, taskId) => get(bookId, taskId),
    list: async bookId => [...tasks.values()].filter(t => t.bookId === bookId).map(t => structuredClone(t)),
    cancel: async (bookId, taskId) => get(bookId, taskId),
  };
}
