import type { Meta, StoryObj } from "@storybook/react-vite";
import { PluginMetadata, PluginMetadataLine } from "./PluginMetadata";
import { sampleMetadata } from "./plugin.fixtures";

/**
 * Provenance for a plugin-declared entry, in the two shapes the host offers:
 * the full `PluginMetadata` block, and `PluginMetadataLine` — a single quiet
 * run of values for list rows, where labels would be noise.
 */
const meta = {
  title: "Interface/Plugins/PluginMetadata",
  component: PluginMetadata,
  parameters: { layout: "padded" },
  args: { items: sampleMetadata },
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PluginMetadata>;

export default meta;
type Story = StoryObj<typeof meta>;
type LineStory = StoryObj<typeof PluginMetadataLine>;

/** Horizontal (the default): label/value pairs running across the surface. */
export const Horizontal: Story = {};

/** Vertical, for narrow columns and detail sidebars. */
export const Vertical: Story = {
  args: { layout: "vertical" },
};

/** Labels only — no tags, no dividers. */
export const LabelsOnly: Story = {
  args: {
    items: [
      { kind: "label", label: "Source", value: "Wiktionary", icon: "globe" },
      { kind: "label", label: "License", value: "CC BY-SA 4.0" },
    ],
  },
};

/** A tag group on its own, which renders as chips rather than a value. */
export const TagsOnly: Story = {
  args: { items: [{ kind: "tags", label: "Tags", values: ["noun", "archaic", "literary"] }] },
};

/** An unknown icon name still renders — as the puzzle-piece fallback. */
export const UnknownIcon: Story = {
  args: { items: [{ kind: "label", label: "Source", value: "Custom", icon: "nope" }] },
};

/** Nothing declared: the block collapses instead of leaving a gap. */
export const Empty: Story = {
  args: { items: [] },
};

/** The compact line, as list rows use it: values only, dividers dropped. */
export const Line: LineStory = {
  render: (args) => <PluginMetadataLine {...args} />,
  args: { items: sampleMetadata },
};

/** Long values truncate inside the line rather than pushing the row wide. */
export const LineTruncating: LineStory = {
  render: (args) => (
    <div className="max-w-64 border border-dashed border-border p-2">
      <PluginMetadataLine {...args} />
    </div>
  ),
  args: {
    items: [
      {
        kind: "label",
        label: "Source",
        value: "The Oxford English Dictionary, second edition, volume XII",
        icon: "globe",
      },
    ],
  },
};
