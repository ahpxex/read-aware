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
};

const meta = {
  title: "Features/Shelf/BookRow",
  component: BookRow,
  parameters: { layout: "padded" },
  args: {
    onClick: () => {},
    onRemove: () => {},
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

export const Unread: Story = {
  args: {
    book: { ...base, title: "Austerlitz", author: "W. G. Sebald" },
  },
};

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
