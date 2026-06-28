import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReadingHeatmap } from "./ReadingHeatmap";
import { localDayKey, type DailyReadingMap } from "../../reader/lib/reading-stats";

/** Fixed reference day so the grid is deterministic across renders. */
const NOW = new Date(2026, 5, 28).getTime();

/** Deterministic sample: most days read, with varied minutes and some gaps. */
function sampleDaily(days: number, density = 5): DailyReadingMap {
  const daily: DailyReadingMap = {};
  for (let i = 0; i < days; i += 1) {
    const d = new Date(NOW);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const seed = (i * 2654435761) >>> 0;
    if (seed % density === 0) continue; // scatter empty days
    const minutes = 5 + (seed % 130);
    daily[localDayKey(d.getTime())] = minutes * 60_000;
  }
  return daily;
}

const meta = {
  title: "Features/Stats/ReadingHeatmap",
  component: ReadingHeatmap,
  parameters: { layout: "padded" },
  args: { now: NOW },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-2xl rounded-md border border-border bg-[var(--ra-main-surface-color)] p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReadingHeatmap>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SixMonths: Story = {
  args: { daily: sampleDaily(180) },
};

export const MultiYear: Story = {
  args: { daily: sampleDaily(730) },
};

export const Sparse: Story = {
  args: { daily: sampleDaily(150, 2) },
};

export const Empty: Story = {
  args: { daily: {} },
};
