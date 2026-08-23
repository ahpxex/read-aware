import type { Meta, StoryObj } from "@storybook/react-vite";
import { computeAchievements, type AchievementFacts } from "../lib/reading-insights";
import { Achievements } from "./Achievements";
import { emptyStore, freshStore, NOW, sampleBooks, sampleStore } from "./stats.fixtures";

/** Facts are computed from the fixture stores rather than hand-written, so the
    tiles stay consistent with what the real pipeline would produce. */
const seasoned = computeAchievements(sampleStore, NOW);
const beginner = computeAchievements(freshStore, NOW);
const nothing = computeAchievements(emptyStore, NOW);

const meta = {
  title: "Interface/Stats/Achievements",
  component: Achievements,
  parameters: { layout: "padded" },
  args: { books: sampleBooks },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Achievements>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A long-running habit: every tile filled, with the next time milestone named. */
export const Default: Story = {
  args: { facts: seasoned },
};

/** A week-old install — small numbers, short streak, one book. */
export const JustStarted: Story = {
  args: { facts: beginner },
};

/** Nothing recorded: the grid holds its shape, "most read" falls back to a dash. */
export const NoReadingYet: Story = {
  args: { facts: nothing },
};

/** A streak that is still running shows the current count under the record. */
export const ActiveStreak: Story = {
  args: {
    facts: { ...seasoned, longestStreak: 46, currentStreak: 46 } satisfies AchievementFacts,
  },
};

/** A broken streak: the record stands alone, with no "current" hint. */
export const BrokenStreak: Story = {
  args: { facts: { ...seasoned, longestStreak: 46, currentStreak: 0 } },
};

/**
 * Past the last milestone the hint switches from a target to the "all passed"
 * line — the tile must never render an empty hint.
 */
export const AllMilestonesPassed: Story = {
  args: { facts: { ...seasoned, totalMs: 5_000 * 3_600_000 } },
};

/** The most-read book is gone from the library; the tile falls back to a dash. */
export const MostReadBookMissing: Story = {
  args: { facts: { ...seasoned, mostReadBookId: "book-deleted" } },
};
