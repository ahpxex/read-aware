import type { Meta, StoryObj } from "@storybook/react-vite";
import type { DailyReadingMap } from "../../reader/lib/reading-stats";
import { localDayKey } from "../../reader/lib/reading-stats";
import { NOW, sampleStore } from "./stats.fixtures";
import { WeeklyBars } from "./WeeklyBars";

/** A daily map built from explicit minute values, most recent day last. */
function daysAgo(minutesByDayOffset: Record<number, number>): DailyReadingMap {
  const daily: DailyReadingMap = {};
  for (const [offset, minutes] of Object.entries(minutesByDayOffset)) {
    const day = new Date(NOW);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - Number(offset));
    daily[localDayKey(day.getTime())] = minutes * 60_000;
  }
  return daily;
}

const meta = {
  title: "Interface/Stats/WeeklyBars",
  component: WeeklyBars,
  parameters: { layout: "padded" },
  args: { now: NOW },
  decorators: [
    (Story) => (
      <div className="max-w-72">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof WeeklyBars>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A typical week: uneven sessions, today's bar inked darker than the rest. */
export const Default: Story = {
  args: {
    daily: daysAgo({ 0: 48, 1: 25, 2: 0, 3: 62, 4: 31, 5: 12, 6: 40 }),
  },
};

/** Days off leave a hairline stub, so the week's shape stays readable. */
export const WithGaps: Story = {
  args: { daily: daysAgo({ 0: 35, 2: 55, 5: 20 }) },
};

/** One outsized session flattens the rest — the scale is per-week, not global. */
export const SingleDominantDay: Story = {
  args: { daily: daysAgo({ 0: 15, 1: 10, 3: 240, 6: 20 }) },
};

/** Not read today: no bar carries the dark "today" treatment. */
export const NothingToday: Story = {
  args: { daily: daysAgo({ 1: 44, 2: 30, 4: 52 }) },
};

/** Nothing recorded at all — seven stubs, no crash on an empty max. */
export const Empty: Story = {
  args: { daily: {} },
};

/** Taller variant, as embedded in a wider panel. */
export const TallerBars: Story = {
  args: {
    daily: daysAgo({ 0: 48, 1: 25, 2: 18, 3: 62, 4: 31, 5: 12, 6: 40 }),
    height: 96,
  },
};

/** Against the shared fixture store, so it matches the other stats stories. */
export const FromSampleStore: Story = {
  args: { daily: sampleStore["book-pale-fire"].daily },
};
