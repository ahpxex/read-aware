import type { Meta, StoryObj } from "@storybook/react-vite";
import { PeriodOverview } from "./PeriodOverview";
import {
  emptyStore,
  freshStore,
  NOW,
  sampleAnnotations,
  sampleBooks,
  sampleStore,
} from "./stats.fixtures";

/**
 * One period tab's whole body. The four tabs are not cosmetic variants of each
 * other — week drops the weekday chart and pairs the bars with the hour
 * histogram, year and all-time add the heatmap, and only all-time computes
 * milestones — so each period gets its own story.
 */
const meta = {
  title: "Interface/Stats/PeriodOverview",
  component: PeriodOverview,
  parameters: { layout: "padded" },
  args: {
    store: sampleStore,
    books: sampleBooks,
    annotations: sampleAnnotations,
    now: NOW,
    period: "all",
    onOpenBook: () => {},
  },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-3xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PeriodOverview>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Week: sparse daily bars beside the hour histogram, no weekday breakdown. */
export const Week: Story = {
  args: { period: "week" },
};

/** Month: full-width daily bars, both rhythm charts, no heatmap. */
export const Month: Story = {
  args: { period: "month" },
};

/** Year: monthly bars plus the reading calendar. */
export const Year: Story = {
  args: { period: "year" },
};

/** All time — the only period that renders the milestones section. */
export const AllTime: Story = {};

/** A fresh install seen through the all-time tab: real but tiny numbers. */
export const JustStarted: Story = {
  args: { store: freshStore },
};

/**
 * Nothing recorded. Every section must degrade quietly — zeroed headlines, no
 * delta badge, the "no books in period" note — rather than collapse.
 */
export const NoReadingYet: Story = {
  args: { store: emptyStore },
};
