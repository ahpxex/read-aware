import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatTile } from "./StatTile";

const meta = {
  title: "Interface/Stats/StatTile",
  component: StatTile,
  parameters: { layout: "padded" },
} satisfies Meta<typeof StatTile>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Label over figure — the whole component. */
export const Default: Story = {
  args: { label: "Total reading", value: "142h 20m" },
};

/** With the optional second line, used for a target or a qualifier. */
export const WithHint: Story = {
  args: { label: "Longest streak", value: "31 days", hint: "current: 12" },
};

/** Long values truncate rather than wrap — the grid keeps its columns. */
export const Truncated: Story = {
  decorators: [
    (Story) => (
      <div className="w-40 border border-dashed border-border p-2">
        <Story />
      </div>
    ),
  ],
  args: {
    label: "Most read",
    value: "Tractatus Logico-Philosophicus",
    hint: "18h 40m across four months",
  },
};

/** A dash stands in for "nothing yet"; the tile never collapses. */
export const Empty: Story = {
  args: { label: "Most read", value: "—" },
};

/** In situ: the milestones grid these tiles are built for. The first tile is
    driven by the controls, so the grid doubles as a fit test. */
export const InGrid: Story = {
  args: { label: "Total reading", value: "142h 20m", hint: "next: 150h" },
  render: (args) => (
    <div className="grid w-[36rem] grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
      <StatTile {...args} />
      <StatTile label="Longest streak" value="31 days" hint="current: 12" />
      <StatTile label="Best day" value="4h 05m" hint="Mar 14" />
      <StatTile label="Days read" value="208" />
      <StatTile label="Books read" value="4" />
      <StatTile label="Most read" value="Pale Fire" hint="61h 10m" />
    </div>
  ),
};
