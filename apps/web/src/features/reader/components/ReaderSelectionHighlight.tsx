import type { ReaderSelectionState } from "../lib/selection-overlay";

/**
 * 自绘选区高亮。iOS 上原生选中菜单和 app 的选择菜单会叠成双份（#10）——
 * 解法是捕获后立刻清掉原生选区（菜单无处依附），但原生的蓝色高亮也随之
 * 消失，由这层用捕获时算好的 rects 补回来。坐标已是 reader 根元素空间；
 * 任何滚动/翻页本来就会清掉选区，快照式静态绘制正好。
 */
export function ReaderSelectionHighlight({
  selection,
}: {
  selection: ReaderSelectionState | null;
}) {
  if (!selection || selection.rects.length === 0) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10">
      {selection.rects.map((rect, index) => (
        <div
          key={index}
          className="absolute rounded-[2px] bg-[#60a5fa]/30"
          style={{
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          }}
        />
      ))}
    </div>
  );
}
