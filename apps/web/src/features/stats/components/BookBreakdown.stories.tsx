import type { Meta, StoryObj } from "@storybook/react-vite";
import { BookBreakdown } from "./BookBreakdown";
import {
  emptyAnnotations,
  emptyStore,
  NOW,
  sampleAnnotations,
  sampleBooks,
  sampleStore,
} from "./stats.fixtures";

const meta = {
  title: "Interface/Stats/BookBreakdown",
  component: BookBreakdown,
  parameters: { layout: "padded" },
  args: {
    books: sampleBooks,
    store: sampleStore,
    now: NOW,
    annotations: sampleAnnotations,
    period: "all",
    onOpenBook: () => {},
  },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BookBreakdown>;

export default meta;
type Story = StoryObj<typeof meta>;

/** All time: every book that has ever been read, richest first. */
export const AllTime: Story = {};

/**
 * The past week. Time and active days are scoped to the window, so books that
 * were finished months ago drop out entirely — progress alone doesn't qualify.
 */
export const ThisWeek: Story = {
  args: { period: "week" },
};

/** A month, where the sporadic books start reappearing. */
export const ThisMonth: Story = {
  args: { period: "month" },
};

/** A year — nearly the all-time list, but the oldest history is trimmed off. */
export const ThisYear: Story = {
  args: { period: "year" },
};

/** Books with no notes or highlights simply omit those figures. */
export const WithoutAnnotations: Story = {
  args: { annotations: emptyAnnotations },
};

/**
 * The store still holds a book the library no longer has (removed after
 * reading). It must be filtered out, not rendered as a blank row.
 */
export const OrphanedStoreEntry: Story = {
  args: { books: sampleBooks.filter((book) => book.id !== "book-pale-fire") },
};

/** Read nothing in the window: the quiet one-line note, not an empty list. */
export const NothingInPeriod: Story = {
  args: { store: emptyStore },
};
