import type { Meta, StoryObj } from "@storybook/react-vite";
import { EpubReaderView } from "./EpubReaderView";
import demoEpubUrl from "../../../../demo/ElonMusk.epub?url";
import type { LibraryBook } from "../../library/lib/library-types";

const sampleBook: LibraryBook = {
  id: "reader-story-book",
  title: "The Master and Margarita",
  author: "Mikhail Bulgakov",
  format: "epub",
  fileName: "the-master-and-margarita.epub",
  mimeType: "application/epub+zip",
  fileSize: 4096,
  createdAt: "2026-03-13T00:00:00.000Z",
  updatedAt: "2026-03-13T00:00:00.000Z",
  lastOpenedAt: "2026-03-13T01:00:00.000Z",
  progressPercent: 64,
  readingStatus: "reading",
  progress: {
    format: "epub",
    currentLocation: 64,
    totalLocations: 100,
    progressPercent: 64,
    cfi: "epubcfi(/6/2[chapter]!/4/2/6)",
    href: "chapter-6.xhtml",
  },
};

const meta = {
  title: "Features/Reader/EpubReaderView",
  component: EpubReaderView,
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
} satisfies Meta<typeof EpubReaderView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Epub: Story = {
  args: {
    initialEpubUrl: demoEpubUrl,
  },
};

export const FromShelfSelection: Story = {
  args: {
    selectedBook: sampleBook,
  },
};
