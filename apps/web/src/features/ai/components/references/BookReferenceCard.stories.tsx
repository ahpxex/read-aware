import type { Meta, StoryObj } from "@storybook/react-vite";
import type { LibraryBook } from "../../../library/lib/library-types";
import { BookReferenceCard } from "./BookReferenceCard";

const HYDRATED: LibraryBook = {
  id: "b1",
  title: "Debt: The First 5000 Years",
  author: "David Graeber",
  format: "epub",
  fileName: "debt.epub",
  mimeType: "application/epub+zip",
  fileSize: 1_024_000,
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  lastOpenedAt: "2026-07-05T00:00:00.000Z",
  progressPercent: 42,
  readingStatus: "reading",
  progress: null,
};

const meta = {
  title: "Interface/AI/References/BookReferenceCard",
  component: BookReferenceCard,
  decorators: [
    (Story) => (
      <div className="max-w-sm bg-paper p-4">
        <Story />
      </div>
    ),
  ],
  args: {
    reference: { bookId: "b1", title: "Debt: The First 5000 Years", author: "David Graeber" },
  },
} satisfies Meta<typeof BookReferenceCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Hydrated from the shelf: placeholder cover, author, live progress. */
export const Hydrated: Story = {
  args: { book: HYDRATED },
};

/** Still loading — renders the persisted snapshot, upgrades in place. */
export const Loading: Story = {
  args: { book: null },
};

/** The book left the shelf: muted, not clickable, with a quiet caption. */
export const Missing: Story = {
  args: { book: undefined },
};
