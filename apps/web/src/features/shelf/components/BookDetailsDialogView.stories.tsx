import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { readingStatsAtom } from "../../../state/ui";
import { seed, withAtoms } from "../../../story-support/atoms";
import { emptyHourBuckets } from "../../reader/lib/reading-stats";
import { BookDetailsDialogView } from "./BookDetailsDialogView";
import { book, marksState } from "./book-dialogs.fixtures";

/** 14h 20m of reading against this book, so the stat strip isn't all zeroes. */
const withReadingTime = withAtoms(
  seed(readingStatsAtom, {
    [book.id]: {
      bookId: book.id,
      firstStartedAt: Date.UTC(2026, 0, 2),
      lastReadAt: Date.UTC(2026, 5, 28),
      totalMs: 51_600_000,
      daily: { "2026-06-28": 3_600_000 },
      byHour: emptyHourBuckets(),
    },
  }),
);

/**
 * Book details from the shelf. No visible title — the cover and the book's own
 * title say what this is. The highlight and note counts open a second page in
 * the same dialog that lists, filters and searches the book's marks; a row
 * there opens the book at the passage.
 *
 * The `BookDetailsDialog` container observes the marks from the desktop
 * store, so these stories render the view with the marks handed in.
 */
const meta = {
  title: "Interface/Shelf/BookDetailsDialog",
  component: BookDetailsDialogView,
  parameters: { layout: "fullscreen" },
  args: { book, open: true, onClose: () => {}, marks: marksState() },
  decorators: [withReadingTime],
} satisfies Meta<typeof BookDetailsDialogView>;

export default meta;
type Story = StoryObj<typeof meta>;

const page = (canvasElement: HTMLElement) => within(canvasElement.ownerDocument.body);

/** Details, read-only: no `onUpdateMetadata`, so no Edit action is offered. */
export const Details: Story = {};

/** With metadata editing available — the case the shelf actually uses. */
export const DetailsEditable: Story = {
  args: { onUpdateMetadata: () => {} },
};

/** The inline title/author form, for correcting auto-detected metadata. */
export const DetailsEditing: Story = {
  args: { onUpdateMetadata: () => {} },
  play: async ({ canvasElement }) => {
    await userEvent.click(await page(canvasElement).findByRole("button", { name: "Edit" }));
  },
};

/** No highlights or notes yet: the counts read 0 and open nothing. */
export const NoMarks: Story = {
  args: { marks: marksState({ marks: [] }) },
  play: async ({ canvasElement }) => {
    await page(canvasElement).findByText("Highlights");
    await expect(page(canvasElement).queryByRole("button", { name: /Highlights/ })).toBeNull();
  },
};

/** The marks are still loading: the counts are unknown, not zero. */
export const MarksLoading: Story = {
  args: { marks: marksState({ marks: [], isLoading: true }) },
};

/** The marks could not be read: the counts show "-" and the failure says so. */
export const MarksFailed: Story = {
  args: { marks: marksState({ marks: [], loadFailed: true, loadErrorCode: "annotations/observation-failed" }) },
};

/** No cover extracted: the generated placeholder stands in. */
export const DetailsWithoutCover: Story = {
  args: { book: { ...book, coverUrl: null } },
};

/** An unopened book — progress reads "not started" rather than 0%. */
export const DetailsNotStarted: Story = {
  args: {
    book: { ...book, progressPercent: 0, readingStatus: "unread", progress: null },
  },
};

/** Long titles and authors wrap instead of overflowing the identity column. */
export const DetailsLongMetadata: Story = {
  args: {
    book: {
      ...book,
      title: "The Annals of the Former World: A Geological History of North America",
      author: "John Angus McPhee, with additional notes by the editors",
    },
  },
};

/**
 * The highlight count opens the marks page on the highlights, grouped by
 * chapter; focus lands on the way back.
 */
export const HighlightsPage: Story = {
  play: async ({ canvasElement }) => {
    const body = page(canvasElement);
    await userEvent.click(await body.findByRole("button", { name: /Highlights/ }));
    const back = await body.findByRole("button", { name: "Back to book details" });
    await waitFor(() => expect(back).toHaveFocus());
    await waitFor(() => expect(body.getByText("Commentary")).toBeVisible());
    await expect(body.queryByText(/Kinbote reads himself/)).toBeNull();
  },
};

/** The notes count opens the same page filtered to notes. */
export const NotesPage: Story = {
  play: async ({ canvasElement }) => {
    const body = page(canvasElement);
    await userEvent.click(await body.findByRole("button", { name: /Notes/ }));
    await waitFor(() => expect(body.getByText(/Kinbote reads himself/)).toBeVisible());
    await expect(body.queryByText(/waxwing slain/)).toBeNull();
  },
};

/** Searching the passages and the note text; switching to All widens the filter. */
export const SearchingMarks: Story = {
  play: async ({ canvasElement }) => {
    const body = page(canvasElement);
    await userEvent.click(await body.findByRole("button", { name: /Highlights/ }));
    await userEvent.click(await body.findByRole("button", { name: "All" }));
    await userEvent.click(body.getByRole("button", { name: "Search highlights and notes" }));
    await userEvent.type(body.getByRole("searchbox", { name: "Search highlights and notes" }), "message");
    await waitFor(() => expect(body.getByText(/scribbled in the dark/)).toBeVisible());
    await expect(body.queryByText(/waxwing slain/)).toBeNull();
  },
};

/** A search with no hits says so instead of showing an empty list. */
export const NoSearchMatches: Story = {
  play: async ({ canvasElement }) => {
    const body = page(canvasElement);
    await userEvent.click(await body.findByRole("button", { name: /Highlights/ }));
    await userEvent.click(await body.findByRole("button", { name: "Search highlights and notes" }));
    await userEvent.type(body.getByRole("searchbox", { name: "Search highlights and notes" }), "Zembla");
    await waitFor(() => expect(body.getByText("Nothing matches “Zembla”.")).toBeVisible());
  },
};

/** Without the book's contents the marks still list, newest first, ungrouped. */
export const MarksWithoutChapters: Story = {
  args: { marks: marksState({ chapters: [] }) },
  play: async ({ canvasElement }) => {
    const body = page(canvasElement);
    await userEvent.click(await body.findByRole("button", { name: /Highlights/ }));
    await waitFor(() => expect(body.getByText(/waxwing slain/)).toBeVisible());
    await expect(body.queryByText("Commentary")).toBeNull();
  },
};

/** Back returns to the details with focus on the count that was opened. */
export const BackToDetails: Story = {
  play: async ({ canvasElement }) => {
    const body = page(canvasElement);
    await userEvent.click(await body.findByRole("button", { name: /Notes/ }));
    await userEvent.click(await body.findByRole("button", { name: "Back to book details" }));
    await waitFor(() => expect(body.getByRole("button", { name: /Notes/ })).toHaveFocus());
  },
};

/**
 * Search is an icon at the end of the filter row; it opens a field in its
 * place. Escape closes the search — clearing it — without closing the dialog,
 * and focus returns to the icon.
 */
export const SearchOpensAndCloses: Story = {
  play: async ({ canvasElement }) => {
    const body = page(canvasElement);
    await userEvent.click(await body.findByRole("button", { name: /Highlights/ }));
    await expect(body.queryByRole("searchbox")).toBeNull();
    await userEvent.click(await body.findByRole("button", { name: "Search highlights and notes" }));
    const field = body.getByRole("searchbox", { name: "Search highlights and notes" });
    await waitFor(() => expect(field).toHaveFocus());
    await userEvent.type(field, "waxwing");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(body.queryByRole("searchbox")).toBeNull());
    await expect(body.getByRole("dialog", { name: "Book details" })).toBeInTheDocument();
    await waitFor(() => expect(body.getByRole("button", { name: "Search highlights and notes" })).toHaveFocus());
    await waitFor(() => expect(body.getByText(/flowing shade/)).toBeVisible());
  },
};
