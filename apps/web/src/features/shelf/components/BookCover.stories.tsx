import type { Meta, StoryObj } from "@storybook/react-vite";
import { BookCover } from "./BookCover";
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

// A self-contained fake cover so the story needs no network image.
const fakeCover =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='360'%3E%3Crect width='240' height='360' fill='%231c1917'/%3E%3Ctext x='20' y='52' fill='%23f5f1e8' font-family='Georgia' font-size='24' font-weight='bold'%3EElon Musk%3C/text%3E%3Ctext x='20' y='80' fill='%23a8a29e' font-family='Georgia' font-size='15'%3EWalter Isaacson%3C/text%3E%3C/svg%3E";

const meta = {
  title: "Features/Shelf/BookCover",
  component: BookCover,
  parameters: { layout: "centered" },
  args: {
    onClick: () => {},
    onRemove: () => {},
  },
} satisfies Meta<typeof BookCover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithCover: Story = {
  args: {
    book: {
      ...base,
      title: "Elon Musk",
      author: "Walter Isaacson",
      coverUrl: fakeCover,
      progressPercent: 32,
      readingStatus: "reading",
    },
  },
};

/** When a book has no extractable cover, a deterministic title placeholder is shown. */
export const PlaceholderFallback: Story = {
  args: {
    book: { ...base, title: "Invisible Cities", author: "Italo Calvino" },
  },
};

export const Finished: Story = {
  args: {
    book: {
      ...base,
      title: "The Plague",
      author: "Albert Camus",
      coverUrl: fakeCover,
      progressPercent: 100,
      readingStatus: "finished",
    },
  },
};
