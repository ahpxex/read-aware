import type { Meta, StoryObj } from "@storybook/react-vite";
import { DeltaBadge } from "./DeltaBadge";

const meta = {
  title: "Interface/Stats/DeltaBadge",
  component: DeltaBadge,
  parameters: { layout: "padded" },
} satisfies Meta<typeof DeltaBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Up is solid ink — the only emphasis the badge allows itself. */
export const Increase: Story = {
  args: { value: 0.35 },
};

/** Down is the subtle tone; no red, no green. Monochrome by design. */
export const Decrease: Story = {
  args: { value: -0.18 },
};

/** Rounds to whole percent, so large swings still read as one figure. */
export const LargeSwing: Story = {
  args: { value: 4.2 },
};

/** Anything that rounds to 0% renders nothing — a badge saying "+0%" is noise. */
export const RoundsToZero: Story = {
  args: { value: 0.004 },
};

/** No prior period to compare against: null renders nothing. */
export const NoComparison: Story = {
  args: { value: null },
};

/** A division by zero upstream must not paint "Infinity%". */
export const NotFinite: Story = {
  args: { value: Number.POSITIVE_INFINITY },
};

/** In situ: under the headline figure it qualifies. */
export const UnderAFigure: Story = {
  args: { value: 0.35 },
  render: (args) => (
    <div className="min-w-0">
      <span className="block text-xs text-fg-subtle">Total time</span>
      <div className="mt-1 font-serif text-[28px] leading-none tabular-nums text-fg">
        12h 40m
      </div>
      <DeltaBadge {...args} className="mt-1.5" />
    </div>
  ),
};
