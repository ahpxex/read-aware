import type { Meta, StoryObj } from "@storybook/react-vite";
import { WindowCaptionControlsView } from "./WindowCaptionControlsView";

/**
 * The caption controls the app draws for itself on the frameless Windows and
 * Linux shells — macOS keeps its native traffic lights, and the browser and
 * mobile builds have no window chrome of ours at all.
 *
 * They sit flush in the header's top-right corner and stretch to its full
 * height, so every story frames them in a header-sized bar. The close button
 * is the only control with a colored hover state, matching platform
 * convention.
 */
const meta = {
  title: "Interface/Navigation/WindowCaptionControls",
  component: WindowCaptionControlsView,
  parameters: { layout: "padded" },
  args: {
    maximized: false,
    onMinimize: () => {},
    onToggleMaximize: () => {},
    onClose: () => {},
  },
  decorators: [
    (Story) => (
      <div className="relative h-11 w-full max-w-3xl border-b border-border bg-surface">
        <span className="flex h-full items-center px-4 text-sm text-fg-muted">
          ReadAware
        </span>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WindowCaptionControlsView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A restored window: the middle button offers maximize. */
export const Restored: Story = {};

/** A maximized window: the same button becomes restore, with its own glyph. */
export const Maximized: Story = {
  args: { maximized: true },
};

/** On the paper canvas, which is what the header actually sits on. */
export const OnPaper: Story = {
  decorators: [
    (Story) => (
      <div className="relative h-11 w-full max-w-3xl bg-[var(--ra-main-surface-color)]">
        <Story />
      </div>
    ),
  ],
};

/** A taller header bar, to check the controls stretch rather than float. */
export const TallHeader: Story = {
  decorators: [
    (Story) => (
      <div className="relative h-16 w-full max-w-3xl border-b border-border bg-surface">
        <Story />
      </div>
    ),
  ],
};
