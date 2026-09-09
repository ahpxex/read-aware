/**
 * 阅读器面板意图：兄弟组件（导航条在 FoliateReaderView 里，面板状态在
 * useReaderPanels 里）之间的一次性打开请求。
 * 带 id 的事件式 atom；useReaderPanels 等待就绪后通过共享服务一次完成
 * chrome 显示和目标面板打开，避免两个消费者互相覆盖操作。
 */
import { atom } from "jotai";
import type { ReaderPanel } from "@read-aware/core";

export type ReaderPanelKind = ReaderPanel;

export type ReaderPanelIntent = {
  id: string;
  bookId: string;
  panel: ReaderPanelKind;
};

export const readerPanelIntentAtom = atom<ReaderPanelIntent | null>(null);

// Surface acknowledgements survive a reader remount without consuming the
// independent ChatPanel attachment consumer's request.
export const readerPanelAcknowledgementsAtom = atom<{ panel: string | null; ask: string | null }>({ panel: null, ask: null });

export function createReaderPanelIntent(
  bookId: string,
  panel: ReaderPanelKind,
): ReaderPanelIntent {
  return { id: crypto.randomUUID(), bookId, panel };
}
