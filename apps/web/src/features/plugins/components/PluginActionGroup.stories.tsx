import type { Meta, StoryObj } from "@storybook/react-vite";
import { PluginActionGroup } from "./PluginActionGroup";
import { destructiveActions, noopRunner, sampleActions } from "./plugin.fixtures";

/**
 * Host-rendered buttons for actions a plugin declares. The plugin picks a
 * label, an icon name and a semantic variant; everything else — sizing,
 * spacing, the disabled-while-busy rule — belongs to the host.
 */
const meta = {
  title: "Interface/Plugins/PluginActionGroup",
  component: PluginActionGroup,
  parameters: { layout: "padded" },
  args: { actions: sampleActions, busy: false, onResult: noopRunner },
} satisfies Meta<typeof PluginActionGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Default: buttons, left-aligned, each variant as the plugin declared it. */
export const Buttons: Story = {};

/** Aligned to the end, as detail views place their action row. */
export const AlignedEnd: Story = {
  args: { align: "end" },
};

/** Icon-only display, for dense headers; the label moves into a tooltip. */
export const IconButtons: Story = {
  args: { display: "icons" },
};

/** A danger variant is the strongest emphasis a plugin can ask for. */
export const WithDangerAction: Story = {
  args: { actions: destructiveActions },
};

/** Icon display carries the danger tone through to the icon button. */
export const IconButtonsWithDanger: Story = {
  args: { actions: destructiveActions, display: "icons" },
};

/** While a result is running every action is disabled, not hidden. */
export const Busy: Story = {
  args: { busy: true },
};

/** Actions may omit an icon entirely — the button is then text-only. */
export const WithoutIcons: Story = {
  args: {
    actions: [
      { id: "apply", label: "Apply", variant: "solid", run: () => undefined },
      { id: "reset", label: "Reset", run: () => undefined },
    ],
  },
};

/** An unknown icon name falls back to the puzzle piece rather than vanishing. */
export const UnknownIconName: Story = {
  args: {
    actions: [
      { id: "x", label: "Custom action", icon: "not-a-real-icon", run: () => undefined },
    ],
  },
};

/** Many actions wrap onto a second line instead of overflowing the surface. */
export const Wrapping: Story = {
  args: {
    actions: Array.from({ length: 9 }, (_, i) => ({
      id: `a${i}`,
      label: `Action number ${i + 1}`,
      icon: "sparkle",
      run: () => undefined,
    })),
  },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
};

/** Nothing declared: the group renders nothing rather than an empty bar. */
export const NoActions: Story = {
  args: { actions: [] },
};
