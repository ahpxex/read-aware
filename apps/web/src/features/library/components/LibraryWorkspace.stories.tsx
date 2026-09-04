import type { Meta, StoryObj } from "@storybook/react-vite";
import { activeCollectionAtom } from "../../../state/ui";
import { seed, withAtoms } from "../../../story-support/atoms";
import type { Collection, LibraryBook } from "../lib/library-types";
import { LibraryWorkspace } from "./LibraryWorkspace";

const cover = (fill: string) =>
  `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='360'%3E%3Crect width='240' height='360' fill='%23${fill}'/%3E%3C/svg%3E`;

const TITLES: [string, string, number][] = [
  ["Pale Fire", "Vladimir Nabokov", 62],
  ["The Sea, The Sea", "Iris Murdoch", 24],
  ["Tractatus Logico-Philosophicus", "Ludwig Wittgenstein", 100],
  ["The Annals of the Former World", "John McPhee", 8],
  ["Austerlitz", "W. G. Sebald", 0],
  ["The Rings of Saturn", "W. G. Sebald", 45],
  ["Independent People", "Halldór Laxness", 0],
  ["A Time of Gifts", "Patrick Leigh Fermor", 78],
];

const FILLS = ["1c1917", "44403c", "78716c", "292524", "57534e", "a8a29e", "3f3f46", "525252"];

function book(index: number, patch: Partial<LibraryBook> = {}): LibraryBook {
  const [title, author, progress] = TITLES[index % TITLES.length];
  return {
    id: `book-${index}`,
    title,
    author,
    format: "epub",
    fileName: `book-${index}.epub`,
    mimeType: "application/epub+zip",
    fileSize: 1_200_000 + index * 90_000,
    coverUrl: index % 3 === 2 ? null : cover(FILLS[index % FILLS.length]),
    coverStatus: "none",
    coverBlobKey: null,
    coverLocal: false,
    coverVersion: null,
    createdAt: "2026-01-02T09:00:00.000Z",
    updatedAt: "2026-06-28T19:00:00.000Z",
    lastOpenedAt: progress > 0 ? "2026-06-27T19:00:00.000Z" : null,
    progressPercent: progress,
    readingStatus: progress === 100 ? "finished" : progress > 0 ? "reading" : "unread",
    progress: null,
    starred: index === 0,
    ...patch,
  };
}

const books = Array.from({ length: 8 }, (_, i) => book(i));

const collections: Collection[] = [
  { id: "c1", name: "Philosophy", createdAt: "2026-01-14T10:00:00.000Z" },
  { id: "c2", name: "To read", createdAt: "2026-02-03T10:00:00.000Z" },
];

const inCollection = books.map((entry, i) =>
  i < 3 ? { ...entry, collectionId: "c1" } : entry,
);

/**
 * The library page: the shelf itself, collections as peers among the books, and
 * the batch-selection toolbar.
 *
 * Layout (grid or list) and the open collection live in atoms, so a collection
 * view is reached by seeding one rather than by clicking through.
 */
const meta = {
  title: "Interface/Library/LibraryWorkspace",
  component: LibraryWorkspace,
  parameters: { layout: "fullscreen" },
  args: {
    isReady: true,
    books,
    collections,
    onImport: () => {},
    onOpenBook: () => {},
    onRemoveBook: () => {},
    onToggleStar: () => {},
    onUpdateBookMetadata: () => {},
    onBulkRemove: () => {},
    onCreateCollection: async (name) => ({
      id: `new-${name}`,
      name,
      createdAt: "2026-06-28T10:00:00.000Z",
    }),
    onRenameCollection: () => {},
    onDeleteCollection: () => {},
    onSetBooksCollection: () => {},
  },
} satisfies Meta<typeof LibraryWorkspace>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A stocked shelf with two collections. */
export const Default: Story = {};

/** Still loading the library — skeletons rather than an empty state. */
export const Loading: Story = {
  args: { isReady: false, books: [], collections: [] },
};

/** A first run: nothing imported yet. */
export const Empty: Story = {
  args: { books: [], collections: [] },
};

/**
 * Files are still moving through the import pipeline. That count deliberately
 * keeps an otherwise-empty shelf out of its empty state.
 */
export const Importing: Story = {
  args: { books: [], collections: [], importingCount: 3 },
};

/** Prepared imports whose files aren't durable yet, shown alongside the shelf. */
export const WithPendingBooks: Story = {
  args: { pendingBooks: [book(20, { id: "pending-1", title: "Just dropped in" })] },
};

/** A book is being opened — its cover carries the spinner. */
export const OpeningABook: Story = {
  args: { openingBookId: "book-0" },
};

/** Inside a collection: its own header, with rename and delete. */
export const InsideACollection: Story = {
  args: { books: inCollection },
  decorators: [withAtoms(seed(activeCollectionAtom, "c1"))],
};

/** A collection that has been emptied — the header stays, the shelf doesn't. */
export const EmptyCollection: Story = {
  args: { books },
  decorators: [withAtoms(seed(activeCollectionAtom, "c2"))],
};

/** A large library, where the grid has to keep its rhythm. */
export const LargeLibrary: Story = {
  args: { books: Array.from({ length: 48 }, (_, i) => book(i)) },
};

/** No collections made yet: books only. */
export const WithoutCollections: Story = {
  args: { collections: [] },
};
