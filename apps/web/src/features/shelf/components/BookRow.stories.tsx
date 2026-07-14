import type { Meta, StoryObj } from "@storybook/react-vite";
import { BookRow } from "./BookRow";
import type { LibraryBook } from "../../library/lib/library-types";

const base: LibraryBook = {
  id: "1",
  title: "Untitled",
  author: "Unknown author",
  format: "epub",
  fileName: "book.epub",
  mimeType: "application/epub+zip",
  fileSize: 1024,
  coverUrl: null,
  createdAt: "2026-03-13T00:00:00.000Z",
  updatedAt: "2026-03-13T00:00:00.000Z",
  lastOpenedAt: null,
  progressPercent: 0,
  readingStatus: "unread",
  progress: null,
  starred: false,
};

const meta = {
  title: "Interface/Shelf/BookRow",
  component: BookRow,
  parameters: { layout: "padded" },
  args: {
    onClick: () => {},
    onRemove: () => {},
    onToggleStar: () => {},
    onToggleSelect: () => {},
  },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BookRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A book in progress: cover thumbnail, title/author, and a progress bar. */
export const Reading: Story = {
  args: {
    book: {
      ...base,
      title: "The Master and Margarita",
      author: "Mikhail Bulgakov",
      progressPercent: 64,
      readingStatus: "reading",
    },
  },
};

/** An unread book: "not started" text in place of the progress bar. */
export const Unread: Story = {
  args: {
    book: { ...base, title: "Austerlitz", author: "W. G. Sebald" },
  },
};

/** Selection mode, not yet selected: empty checkbox, row actions hidden. */
export const SelectingUnchecked: Story = {
  args: {
    book: { ...base, title: "Austerlitz", author: "W. G. Sebald" },
    selecting: true,
  },
};

/** Selection mode, selected: filled checkbox and tinted row background. */
export const Selected: Story = {
  args: {
    book: { ...base, title: "Austerlitz", author: "W. G. Sebald" },
    selecting: true,
    selected: true,
  },
};

/** A starred book: the filled star stays visible without hover. */
export const Starred: Story = {
  args: {
    book: { ...base, title: "Invisible Cities", author: "Italo Calvino", starred: true },
  },
};

/** Opening state: a delayed spinner overlays the thumbnail while the reader mounts. */
export const Opening: Story = {
  args: {
    book: {
      ...base,
      title: "The Master and Margarita",
      author: "Mikhail Bulgakov",
      progressPercent: 64,
      readingStatus: "reading",
    },
    opening: true,
  },
};

/** Several rows stacked as they appear in the shelf's list layout. */
export const List: Story = {
  args: { book: base },
  render: () => {
    const books: LibraryBook[] = [
      { ...base, id: "1", title: "The Master and Margarita", author: "Mikhail Bulgakov", progressPercent: 64, readingStatus: "reading" },
      { ...base, id: "2", title: "Thinking, Fast and Slow", author: "Daniel Kahneman", progressPercent: 23, readingStatus: "reading" },
      { ...base, id: "3", title: "Invisible Cities", author: "Italo Calvino" },
      { ...base, id: "4", title: "The Plague", author: "Albert Camus", progressPercent: 100, readingStatus: "finished" },
    ];
    return (
      <div className="flex flex-col divide-y divide-border/60">
        {books.map((book) => (
          <BookRow key={book.id} book={book} onClick={() => {}} onRemove={() => {}} />
        ))}
      </div>
    );
  },
};
