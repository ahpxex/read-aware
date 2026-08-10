/**
 * 阅读器面板意图：兄弟组件（导航条在 FoliateReaderView 里，面板状态在
 * ReaderShellOverlay / useReaderSession 里）之间的一次性打开请求。
 * 与 askAiRequestAtom 同一模式：带 id 的事件式 atom，各消费者按 id 去重、
 * 各自响应——session 负责把 chrome 亮出来，overlay 负责打开目标面板。
 */
import { atom } from "jotai";

export type ReaderPanelKind = "toc" | "annotations" | "appearance" | "chat";

export type ReaderPanelIntent = {
  id: string;
  bookId: string;
  panel: ReaderPanelKind;
};

export const readerPanelIntentAtom = atom<ReaderPanelIntent | null>(null);

export function createReaderPanelIntent(
  bookId: string,
  panel: ReaderPanelKind,
): ReaderPanelIntent {
  return { id: crypto.randomUUID(), bookId, panel };
}
