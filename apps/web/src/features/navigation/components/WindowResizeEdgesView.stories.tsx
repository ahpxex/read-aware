import type { Meta, StoryObj } from "@storybook/react-vite";
import { RESIZE_ZONES, WindowResizeEdgesView } from "./WindowResizeEdgesView";

/**
 * The resize zones for the frameless Linux shell.
 *
 * An undecorated GTK window loses its native resize borders, so the app draws
 * thin strips along the edges and hands any drag straight to the window
 * manager. They are invisible by design — which is exactly why they are worth
 * a story: `showZones` tints them, so the geometry (5px edges, 10px corners,
 * corners winning over edges) can actually be checked.
 */
const meta = {
  title: "Interface/Navigation/WindowResizeEdges",
  component: WindowResizeEdgesView,
  parameters: { layout: "padded" },
  args: { position: "absolute", onBeginResize: () => {} },
  decorators: [
    (Story) => (
      <div className="relative h-80 w-full max-w-2xl overflow-hidden rounded-sm border border-border bg-surface">
        <span className="flex h-full items-center justify-center text-sm text-fg-subtle">
          window content
        </span>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WindowResizeEdgesView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The zones tinted, so their geometry is visible. Hover to see each cursor. */
export const ZonesVisible: Story = {
  args: { showZones: true },
};

/** As shipped: invisible. Hovering the edges still changes the cursor. */
export const AsShipped: Story = {};

/** The zone table itself — direction, geometry and cursor, in one list. */
export const ZoneTable: Story = {
  decorators: [],
  render: () => (
    <div className="mx-auto flex max-w-xl flex-col">
      {RESIZE_ZONES.map(({ direction, style, cursor }) => (
        <div
          key={direction}
          className="flex items-center gap-4 border-t border-border py-2 text-sm first:border-t-0"
        >
          <span className="w-24 shrink-0 text-fg">{direction}</span>
          <code className="min-w-0 flex-1 text-[11px] text-fg-muted">
            {Object.entries(style)
              .map(([key, value]) => `${key}: ${value}`)
              .join(", ")}
          </code>
          <code className="w-24 text-right text-[11px] text-fg-subtle">{cursor}</code>
        </div>
      ))}
    </div>
  ),
};
