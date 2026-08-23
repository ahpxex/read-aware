import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { PluginControlGroup } from "./PluginControlGroup";
import { noopRunner, sampleControls } from "./plugin.fixtures";

/**
 * Compact select controls a plugin declares for a detail view — sorting, scope,
 * and the like. Host-owned rendering: the plugin supplies options and a
 * handler, never a widget.
 */
const meta = {
  title: "Interface/Plugins/PluginControlGroup",
  component: PluginControlGroup,
  parameters: { layout: "padded" },
  args: { controls: sampleControls, busy: false, onResult: noopRunner },
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PluginControlGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Two controls, each showing its current selection. */
export const Default: Story = {};

/** A single control, the common case in a plugin's detail header. */
export const SingleControl: Story = {
  args: { controls: [sampleControls[0]] },
};

/** The open menu, with a check against the selected option. */
export const MenuOpen: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Sort: Most recent" }));
  },
};

/**
 * A value the options don't contain (a stale preference, a renamed option):
 * the trigger falls back to the first option rather than rendering blank.
 */
export const ValueNotInOptions: Story = {
  args: {
    controls: [{ ...sampleControls[0], value: "removed-option" }],
  },
};

/** While a result runs, the options are disabled but the menu still opens. */
export const Busy: Story = {
  args: { busy: true },
};

/** Long option labels truncate in the trigger, keeping the row compact. */
export const LongLabels: Story = {
  args: {
    controls: [
      {
        ...sampleControls[0],
        value: "long",
        options: [
          { value: "long", label: "Least recently reviewed across every book" },
          { value: "short", label: "A–Z" },
        ],
      },
    ],
  },
  decorators: [
    (Story) => (
      <div className="max-w-48 border border-dashed border-border p-2">
        <Story />
      </div>
    ),
  ],
};

/** Nothing declared: no control row at all. */
export const NoControls: Story = {
  args: { controls: [] },
};
