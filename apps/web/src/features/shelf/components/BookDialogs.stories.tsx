import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { readingStatsAtom } from "../../../state/ui";
import { seed, withAtoms } from "../../../story-support/atoms";
import type { LibraryBook } from "../../library/lib/library-types";
import { emptyHourBuckets } from "../../reader/lib/reading-stats";
import { BookDetailsDialog, BookRemoveDialog, BooksRemoveDialog } from "./BookDialogs";

const book: LibraryBook = {
  id: "book-pale-fire",
  title: "Pale Fire",
  author: "Vladimir Nabokov",
  format: "epub",
  fileName: "pale-fire.epub",
  mimeType: "application/epub+zip",
  fileSize: 1_480_000,
  coverUrl:
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='360'%3E%3Crect width='240' height='360' fill='%231c1917'/%3E%3Ctext x='20' y='52' fill='%23f5f1e8' font-family='Georgia' font-size='24' font-weight='bold'%3EPale Fire%3C/text%3E%3Ctext x='20' y='80' fill='%23a8a29e' font-family='Georgia' font-size='15'%3ENabokov%3C/text%3E%3C/svg%3E",
  coverStatus: "none",
  coverBlobKey: null,
  coverLocal: false,
  coverVersion: null,
  createdAt: "2026-01-02T09:00:00.000Z",
  updatedAt: "2026-06-28T19:00:00.000Z",
  lastOpenedAt: "2026-06-28T19:00:00.000Z",
  progressPercent: 62,
  readingStatus: "reading",
  progress: {
    currentLocation: 240,
    totalLocations: 480,
    progressPercent: 62,
    cfi: null,
    href: null,
  },
  starred: true,
};

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
 * The three library dialogs. Highlight and note counts stay at zero here: they
 * load from the annotations store over Tauri IPC, which Storybook has no access
 * to — the dialog's own layout for a book with annotations is covered by
 * AnnotationRow's stories instead.
 */
const meta = {
  title: "Interface/Shelf/BookDialogs",
  component: BookDetailsDialog,
  parameters: { layout: "fullscreen" },
  args: { book, open: true, onClose: () => {} },
  decorators: [withReadingTime],
} satisfies Meta<typeof BookDetailsDialog>;

export default meta;
type Story = StoryObj<typeof meta>;
type RemoveStory = StoryObj<typeof BookRemoveDialog>;
type BulkRemoveStory = StoryObj<typeof BooksRemoveDialog>;

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
    const canvas = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole("button", { name: "Edit" }));
  },
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

/** Single-book removal, which names the book and warns about the stored file. */
export const RemoveOne: RemoveStory = {
  render: (args) => <BookRemoveDialog {...args} />,
  args: { book, open: true, onClose: () => {}, onConfirm: () => {} },
};

/** Bulk removal from the selection toolbar. */
export const RemoveMany: BulkRemoveStory = {
  render: (args) => <BooksRemoveDialog {...args} />,
  args: { count: 7, open: true, onClose: () => {}, onConfirm: () => {} },
};

/** The bulk dialog's singular form, which reads differently from the plural. */
export const RemoveManySingular: BulkRemoveStory = {
  render: (args) => <BooksRemoveDialog {...args} />,
  args: { count: 1, open: true, onClose: () => {}, onConfirm: () => {} },
};
