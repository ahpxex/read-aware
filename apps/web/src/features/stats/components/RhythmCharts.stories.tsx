import type { Meta, StoryObj } from "@storybook/react-vite";
import { emptyHourBuckets } from "../../reader/lib/reading-stats";
import type { WeekdayBucket } from "../lib/reading-insights";
import { TimeOfDayChart, WeekdayChart } from "./RhythmCharts";

const MINUTE = 60_000;

const DAYS: { label: string; full: string }[] = [
  { label: "M", full: "Monday" },
  { label: "T", full: "Tuesday" },
  { label: "W", full: "Wednesday" },
  { label: "T", full: "Thursday" },
  { label: "F", full: "Friday" },
  { label: "S", full: "Saturday" },
  { label: "S", full: "Sunday" },
];

function weekday(minutes: number[]): WeekdayBucket[] {
  return DAYS.map((day, index) => ({ ...day, ms: minutes[index] * MINUTE }));
}

/** An hour histogram with reading concentrated around `peakHour`. */
function hours(peakHour: number, spread = 3, peakMinutes = 180): number[] {
  const byHour = emptyHourBuckets();
  for (let h = 0; h < 24; h += 1) {
    const distance = Math.min(Math.abs(h - peakHour), 24 - Math.abs(h - peakHour));
    if (distance > spread) continue;
    byHour[h] = Math.round(peakMinutes * (1 - distance / (spread + 1))) * MINUTE;
  }
  return byHour;
}

/** Two reading habits in one day — a commute and a bedtime session. */
function bimodal(): number[] {
  const byHour = hours(8, 2, 120);
  const evening = hours(22, 2, 150);
  return byHour.map((ms, h) => ms + evening[h]);
}

const meta = {
  title: "Interface/Stats/RhythmCharts",
  component: WeekdayChart,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WeekdayChart>;

export default meta;
type Story = StoryObj<typeof meta>;
/** The file's second chart takes a different prop, so it gets its own story
    type rather than borrowing WeekdayChart's args. */
type HourStory = StoryObj<typeof TimeOfDayChart>;

/** Weekday distribution with a clear weekend peak, which is inked. */
export const Weekday: Story = {
  args: { weekday: weekday([70, 45, 90, 30, 55, 210, 160]) },
};

/** Near-flat weeks still nominate exactly one peak — the first maximum. */
export const WeekdayFlat: Story = {
  args: { weekday: weekday([60, 60, 60, 60, 60, 60, 60]) },
};

/** Only two days ever read: the empty days show as the faint rule. */
export const WeekdaySparse: Story = {
  args: { weekday: weekday([0, 0, 120, 0, 0, 0, 85]) },
};

/** No reading recorded — no bar is emphasized, the axis still renders. */
export const WeekdayEmpty: Story = {
  args: { weekday: weekday([0, 0, 0, 0, 0, 0, 0]) },
};

/** An evening reader: the peak hour is named in the caption and inked. */
export const TimeOfDayEvening: HourStory = {
  render: (args) => <TimeOfDayChart {...args} />,
  args: { byHour: hours(21) },
};

/** A morning reader, to check the caption's hour formatting at the other end. */
export const TimeOfDayMorning: HourStory = {
  render: (args) => <TimeOfDayChart {...args} />,
  args: { byHour: hours(6, 2, 95) },
};

/** Two habits (commute and bedtime); only the true maximum is inked. */
export const TimeOfDayBimodal: HourStory = {
  render: (args) => <TimeOfDayChart {...args} />,
  args: { byHour: bimodal() },
};

/**
 * The histogram only accrues going forward, so a fresh install has none. It
 * shows a quiet note at the chart's height instead of an empty plot.
 */
export const TimeOfDayNoData: HourStory = {
  render: (args) => <TimeOfDayChart {...args} />,
  args: { byHour: emptyHourBuckets() },
};

/** Both charts side by side, the way every non-week period tab lays them out. */
export const RhythmRow: Story = {
  args: { weekday: weekday([70, 45, 90, 30, 55, 210, 160]) },
  render: (args) => (
    <div className="grid gap-8 sm:grid-cols-2">
      <WeekdayChart {...args} />
      <TimeOfDayChart byHour={hours(21)} />
    </div>
  ),
};
