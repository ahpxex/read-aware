import type { Meta, StoryObj } from "@storybook/react-vite";
import { readingStatsAtom } from "../../../state/ui";
import { seed, withAtoms } from "../../../story-support/atoms";
import { StatsWorkspace } from "./StatsWorkspace";
import { freshStore, sampleBooks, sampleStore } from "./stats.fixtures";

/**
 * The whole stats page: headline summary plus the four period tabs.
 *
 * The reading store comes from `readingStatsAtom`, so the stories seed it
 * rather than relying on whatever this Storybook origin's localStorage holds.
 * Annotation counts are the one thing that stays zero here — they load from
 * the annotations store over Tauri IPC, which isn't there; `BookBreakdown`
 * has its own stories covering the populated case.
 *
 * Note the dev-only auto-seed inside the component: with books present and
 * under an hour of reading, it overwrites the store with generated history and
 * renders nothing for a beat. Every story below either seeds well past that
 * threshold or passes no books, so none of them trip it.
 */
const meta = {
  title: "Interface/Stats/StatsWorkspace",
  component: StatsWorkspace,
  parameters: { layout: "fullscreen" },
  args: { books: sampleBooks, onOpenBook: () => {} },
} satisfies Meta<typeof StatsWorkspace>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A well-stocked history: summary line, streak, and all four tabs populated. */
export const Default: Story = {
  decorators: [withAtoms(seed(readingStatsAtom, sampleStore))],
};

/**
 * A single book read across one week. Enough to clear the auto-seed threshold,
 * little enough that the year and all-time tabs stay nearly bare.
 */
export const SparseHistory: Story = {
  decorators: [withAtoms(seed(readingStatsAtom, freshStore))],
};

/**
 * No reading recorded and no books to seed from: the page is one empty state,
 * not an empty chart grid.
 */
export const NoReadingYet: Story = {
  args: { books: [] },
  decorators: [withAtoms(seed(readingStatsAtom, {}))],
};
