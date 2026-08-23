import type { Meta, StoryObj } from "@storybook/react-vite";
import type { StatsBar } from "../lib/reading-insights";
import { ReadingBars } from "./ReadingBars";

const MINUTE = 60_000;

/** Deterministic bar series; the last bucket is the "current" one. */
function bars(minutes: number[], labelFor: (index: number) => string): StatsBar[] {
  return minutes.map((m, index) => ({
    key: `b${index}`,
    label: labelFor(index),
    ms: m * MINUTE,
    isCurrent: index === minutes.length - 1,
  }));
}

const WEEK = bars([40, 25, 0, 62, 31, 12, 48], (i) =>
  ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i],
);

const MONTH = bars(
  [22, 41, 0, 35, 18, 60, 12, 0, 44, 29, 51, 8, 33, 47, 0, 26, 39, 14, 55, 21,
    0, 36, 42, 17, 30, 9, 48, 25, 0, 38],
  (i) => `${i + 1}`,
);

const YEAR = bars(
  [620, 940, 410, 1180, 760, 300, 880, 1420, 690, 1050, 520, 970],
  (i) =>
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][i],
);

const meta = {
  title: "Interface/Stats/ReadingBars",
  component: ReadingBars,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReadingBars>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A week of daily buckets. Every label fits, so none are thinned; the current
 * bucket is inked, and clicking any column moves the ink there (useActiveBar).
 */
export const Week: Story = {
  args: { bars: WEEK, height: 110 },
};

/**
 * Past 14 bars the chart switches to dense mode: tighter gaps and thinned
 * axis labels, so a month of days stays legible.
 */
export const Month: Story = {
  args: { bars: MONTH },
};

/** Monthly buckets over a year — the shape the year and all-time tabs use. */
export const Year: Story = {
  args: { bars: YEAR },
};

/** Zero buckets render as a faint rule rather than disappearing. */
export const WithEmptyBuckets: Story = {
  args: { bars: bars([0, 0, 30, 0, 0, 45, 0], (i) => `d${i + 1}`), height: 110 },
};

/** One spike sets the scale; the rest still have to remain visible. */
export const SingleSpike: Story = {
  args: { bars: bars([5, 8, 240, 6, 4, 9, 7], (i) => `d${i + 1}`), height: 110 },
};

/** No reading in the window at all — axes hold, bars flatten to the rule. */
export const AllZero: Story = {
  args: { bars: bars([0, 0, 0, 0, 0, 0, 0], (i) => `d${i + 1}`), height: 110 },
};

/** Nothing to plot: recharts must not be handed an empty domain and crash. */
export const NoBars: Story = {
  args: { bars: [], height: 110 },
};
