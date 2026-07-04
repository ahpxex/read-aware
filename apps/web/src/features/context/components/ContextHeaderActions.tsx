/**
 * Context 页占用 AppHeader 右侧动作簇时渲染的内容：只保留 Memory 与
 * Annotations 两个弹层图标（替代默认的搜索 / 导入 / 导航 / 设置簇），
 * 与 reader 顶栏的弹层交互一致。
 */
import type { LibraryBook } from "../../library/lib/library-types";
import { AnnotationsPopover } from "./AnnotationsPopover";
import { MemoryPopover } from "./MemoryPopover";

type ContextHeaderActionsProps = {
  books: LibraryBook[];
  onOpenBook: (book: LibraryBook) => void;
};

export function ContextHeaderActions({ books, onOpenBook }: ContextHeaderActionsProps) {
  return (
    <>
      <MemoryPopover />
      <AnnotationsPopover books={books} onOpenBook={onOpenBook} />
    </>
  );
}
