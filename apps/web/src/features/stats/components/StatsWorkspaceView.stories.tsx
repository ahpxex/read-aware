import type { Meta, StoryObj } from "@storybook/react-vite";
import { readingStatsAtom } from "../../../state/ui";
import { seed, withAtoms } from "../../../story-support/atoms";
import { StatsWorkspaceView } from "./StatsWorkspaceView";
import { emptyAnnotations, freshStore, sampleAnnotations, sampleBooks, sampleStore } from "./stats.fixtures";

/**
 * The whole stats page: headline summary plus the four period tabs.
 *
 * The reading store comes from `readingStatsAtom`, so the stories seed it
 * rather than relying on whatever this Storybook origin's localStorage holds.
 * Annotation counts come in as a prop — the `StatsWorkspace` container loads
 * them from the annotations store, which only the desktop app has.
 */
const meta = {
  title: "Interface/Stats/StatsWorkspace",
  component: StatsWorkspaceView,
  parameters: { layout: "fullscreen" },
  args: { books: sampleBooks, annotations: sampleAnnotations, onOpenBook: () => {} },
} satisfies Meta<typeof StatsWorkspaceView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A well-stocked history: summary line, streak, and all four tabs populated. */
export const Default: Story = {
  decorators: [withAtoms(seed(readingStatsAtom, sampleStore))],
};

/**
 * A single book read across one week, with no annotations: the year and
 * all-time tabs stay nearly bare.
 */
export const SparseHistory: Story = {
  args: { annotations: emptyAnnotations },
  decorators: [withAtoms(seed(readingStatsAtom, freshStore))],
};

/**
 * The annotation counts failed to load. The page says so above the tabs (with
 * a retry) instead of passing the zeros off as data.
 */
export const AnnotationCountsFailed: Story = {
  args: { annotations: { ...emptyAnnotations, loadFailed: true } },
  decorators: [withAtoms(seed(readingStatsAtom, sampleStore))],
};

/**
 * No reading recorded: the page is one empty state, not an empty chart grid.
 */
export const NoReadingYet: Story = {
  args: { books: [], annotations: emptyAnnotations },
  decorators: [withAtoms(seed(readingStatsAtom, {}))],
};
