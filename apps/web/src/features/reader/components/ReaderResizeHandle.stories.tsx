import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { ReaderResizeHandle } from "./ReaderResizeHandle";

/**
 * The thin divider on a reader panel's edge.
 *
 * It is deliberately almost invisible until pointed at — a hairline appears on
 * hover, and pointer capture keeps the drag tracking even as the cursor crosses
 * the book's iframe. The handle itself is 8px wide and sits half outside the
 * panel, so these stories give it a panel to sit on.
 */
const meta = {
  title: "Interface/Reader/ReaderResizeHandle",
  component: ReaderResizeHandle,
  parameters: { layout: "centered" },
  args: {
    edge: "left",
    ariaLabel: "Resize panel",
    onResize: () => {},
    onCommit: () => {},
  },
} satisfies Meta<typeof ReaderResizeHandle>;

export default meta;
type Story = StoryObj<typeof meta>;

/** On a panel's left edge — the chat panel's case. Hover to reveal the rule. */
export const LeftEdge: Story = {
  render: (args) => (
    <div className="flex h-64 w-[32rem]">
      <div className="flex-1 bg-fill p-4 text-sm text-fg-muted">book</div>
      <div className="relative w-56 border-l border-border bg-surface p-4 text-sm text-fg">
        panel
        <ReaderResizeHandle {...args} edge="left" />
      </div>
    </div>
  ),
};

/** On a panel's right edge, for a panel docked to the left. */
export const RightEdge: Story = {
  args: { edge: "right" },
  render: (args) => (
    <div className="flex h-64 w-[32rem]">
      <div className="relative w-56 border-r border-border bg-surface p-4 text-sm text-fg">
        panel
        <ReaderResizeHandle {...args} edge="right" />
      </div>
      <div className="flex-1 bg-fill p-4 text-sm text-fg-muted">book</div>
    </div>
  ),
};

/**
 * Wired to a real width, so the drag can be tried: the handle reports
 * incremental deltas and the panel owns the resulting width and its bounds.
 */
export const Draggable: Story = {
  render: function Draggable(args) {
    const [width, setWidth] = useState(224);
    const [committed, setCommitted] = useState(224);
    return (
      <div className="flex h-64 w-[32rem]">
        <div className="flex-1 bg-fill p-4 text-sm text-fg-muted">book</div>
        <div
          className="relative shrink-0 border-l border-border bg-surface p-4 text-sm text-fg"
          style={{ width }}
        >
          <span className="block tabular-nums">{Math.round(width)}px</span>
          <span className="mt-1 block text-xs tabular-nums text-fg-subtle">
            committed: {Math.round(committed)}px
          </span>
          <ReaderResizeHandle
            {...args}
            edge="left"
            onResize={(delta) => setWidth((w) => Math.min(400, Math.max(160, w - delta)))}
            onCommit={() => setCommitted(width)}
          />
        </div>
      </div>
    );
  },
};
