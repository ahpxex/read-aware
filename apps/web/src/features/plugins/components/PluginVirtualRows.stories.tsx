import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";
import { ScrollArea } from "@read-aware/ui";
import { PluginVirtualRows, type VirtualRow } from "./PluginVirtualRows";

/** A saved-word row, the shape this list was built to window. */
function row(index: number): VirtualRow {
  return {
    key: `w${index}`,
    size: 64,
    content: (
      <div className="border-b border-border px-4 py-3">
        <span className="block font-serif text-sm text-fg">Entry {index + 1}</span>
        <span className="mt-0.5 block text-xs text-fg-muted">
          Saved from Pale Fire · commentary, line {index * 3 + 1}
        </span>
      </div>
    ),
  };
}

/**
 * Windowed rows for plugin list bodies.
 *
 * The component deliberately owns no scroll region — it virtualizes against
 * the nearest `.ra-scrollarea` ancestor, so the scrollbar belongs to the host
 * surface. Each story therefore supplies one explicitly rather than inheriting
 * it from the meta — "NoScrollHost" below depends on there being none, and a
 * meta decorator would still be found by `closest()` from inside the story.
 */
const scrolled: Decorator = (Story) => (
  <ScrollArea className="h-96 max-w-xl rounded-md border border-border">
    <Story />
  </ScrollArea>
);

const meta = {
  title: "Interface/Plugins/PluginVirtualRows",
  component: PluginVirtualRows,
  parameters: { layout: "padded" },
} satisfies Meta<typeof PluginVirtualRows>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two thousand entries; only the visible window is ever in the DOM. */
export const LongList: Story = {
  decorators: [scrolled],
  args: { rows: Array.from({ length: 2000 }, (_, i) => row(i)) },
};

/** Fewer rows than fill the viewport — no windowing effect, no blank space. */
export const ShortList: Story = {
  decorators: [scrolled],
  args: { rows: Array.from({ length: 4 }, (_, i) => row(i)) },
};

/** Rows whose real height exceeds the estimate must be re-measured, not clipped. */
export const VariableHeightRows: Story = {
  decorators: [scrolled],
  args: {
    rows: Array.from({ length: 200 }, (_, i) => ({
      key: `v${i}`,
      size: 64,
      content: (
        <div className="border-b border-border px-4 py-3">
          <span className="block font-serif text-sm text-fg">Entry {i + 1}</span>
          <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">
            {"A longer note that wraps across several lines. ".repeat((i % 4) + 1)}
          </p>
        </div>
      ),
    })),
  },
};

/**
 * Content above the list (a search field, a tab strip) offsets it inside the
 * scroller. The list measures that offset and keeps following it as the header
 * resizes — otherwise every row would land shifted.
 */
export const OffsetByHeaderContent: Story = {
  args: { rows: Array.from({ length: 500 }, (_, i) => row(i)) },
  decorators: [
    (Story) => (
      <div>
        <div className="border-b border-border bg-fill px-4 py-6">
          <span className="text-sm text-fg-muted">Filters and search live here</span>
        </div>
        <Story />
      </div>
    ),
    scrolled,
  ],
};

/** Nothing to show: an empty container, and no crash on an empty estimate. */
export const Empty: Story = {
  decorators: [scrolled],
  args: { rows: [] },
};

/**
 * No `.ra-scrollarea` ancestor. The list refuses to render rows rather than
 * mounting all of them against an unbounded viewport — the exact failure the
 * component exists to prevent.
 */
export const NoScrollHost: Story = {
  args: { rows: Array.from({ length: 500 }, (_, i) => row(i)) },
  decorators: [
    (Story) => (
      <div className="h-96 max-w-xl overflow-auto rounded-md border border-dashed border-border">
        <Story />
      </div>
    ),
  ],
};
