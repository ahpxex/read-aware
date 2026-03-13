import type { Meta, StoryObj } from "@storybook/react-vite";
import { PdfReaderView } from "./PdfReaderView";
import demoPdfUrl from "../../../../demo/AtomicHabits.pdf?url";
import type { LibraryBook } from "../../library/lib/library-types";

const sampleBook: LibraryBook = {
  id: "reader-story-book",
  title: "Atomic Habits",
  author: "James Clear",
  format: "pdf",
  fileName: "atomic-habits.pdf",
  mimeType: "application/pdf",
  fileSize: 4096,
  createdAt: "2026-03-13T00:00:00.000Z",
  updatedAt: "2026-03-13T00:00:00.000Z",
  lastOpenedAt: null,
  progressPercent: 0,
  readingStatus: "unread",
  progress: null,
};

const meta = {
  title: "Features/Reader/PdfReaderView",
  component: PdfReaderView,
  parameters: {
    layout: "fullscreen",
  },
  decorators: [
    (Story) => (
      <div style={{ height: "100vh" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PdfReaderView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Pdf: Story = {
  args: {
    initialPdfUrl: demoPdfUrl,
  },
};

export const FromShelfSelection: Story = {
  args: {
    selectedBook: sampleBook,
  },
};
