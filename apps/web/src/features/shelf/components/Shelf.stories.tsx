import type { Meta, StoryObj } from "@storybook/react-vite";
import { Shelf } from "./Shelf";
import type { LibraryBook } from "../../library/lib/library-types";

const currentlyReading: LibraryBook[] = [
  {
    id: "1",
    title: "The Master and Margarita",
    author: "Mikhail Bulgakov",
    format: "epub",
    fileName: "the-master-and-margarita.epub",
    mimeType: "application/epub+zip",
    fileSize: 1024,
    createdAt: "2026-03-13T00:00:00.000Z",
    updatedAt: "2026-03-13T00:00:00.000Z",
    lastOpenedAt: "2026-03-13T03:00:00.000Z",
    progressPercent: 64,
    readingStatus: "reading",
    progress: {
      currentLocation: 64,
      totalLocations: 100,
      progressPercent: 64,
      cfi: "epubcfi(/6/2[chapter]!/4/2/6)",
      href: "chapter-6.xhtml",
    },
  },
  {
    id: "2",
    title: "Thinking, Fast and Slow",
    author: "Daniel Kahneman",
    format: "epub",
    fileName: "thinking-fast-and-slow.epub",
    mimeType: "application/epub+zip",
    fileSize: 2048,
    createdAt: "2026-03-13T00:00:00.000Z",
    updatedAt: "2026-03-13T00:00:00.000Z",
    lastOpenedAt: "2026-03-13T02:00:00.000Z",
    progressPercent: 23,
    readingStatus: "reading",
    progress: {
      currentLocation: 23,
      totalLocations: 100,
      progressPercent: 23,
      cfi: "epubcfi(/6/2[chapter]!/4/2/6)",
      href: "chapter-3.xhtml",
    },
  },
];

const upNext: LibraryBook[] = [
  { id: "3", title: "Austerlitz", author: "W. G. Sebald", format: "epub", fileName: "austerlitz.epub", mimeType: "application/epub+zip", fileSize: 1536, createdAt: "2026-03-13T00:00:00.000Z", updatedAt: "2026-03-13T00:00:00.000Z", lastOpenedAt: null, progressPercent: 0, readingStatus: "unread", progress: null },
  { id: "4", title: "The Structure of Scientific Revolutions", author: "Thomas S. Kuhn", format: "epub", fileName: "the-structure-of-scientific-revolutions.epub", mimeType: "application/epub+zip", fileSize: 1536, createdAt: "2026-03-13T00:00:00.000Z", updatedAt: "2026-03-13T00:00:00.000Z", lastOpenedAt: null, progressPercent: 0, readingStatus: "unread", progress: null },
  { id: "5", title: "Invisible Cities", author: "Italo Calvino", format: "epub", fileName: "invisible-cities.epub", mimeType: "application/epub+zip", fileSize: 1536, createdAt: "2026-03-13T00:00:00.000Z", updatedAt: "2026-03-13T00:00:00.000Z", lastOpenedAt: null, progressPercent: 0, readingStatus: "unread", progress: null },
  { id: "6", title: "The Periodic Table", author: "Primo Levi", format: "epub", fileName: "the-periodic-table.epub", mimeType: "application/epub+zip", fileSize: 1536, createdAt: "2026-03-13T00:00:00.000Z", updatedAt: "2026-03-13T00:00:00.000Z", lastOpenedAt: null, progressPercent: 0, readingStatus: "unread", progress: null },
  { id: "7", title: "Pale Fire", author: "Vladimir Nabokov", format: "epub", fileName: "pale-fire.epub", mimeType: "application/epub+zip", fileSize: 1536, createdAt: "2026-03-13T00:00:00.000Z", updatedAt: "2026-03-13T00:00:00.000Z", lastOpenedAt: null, progressPercent: 0, readingStatus: "unread", progress: null },
];

const finished: LibraryBook[] = [
  { id: "8", title: "Blindness", author: "Jose Saramago", format: "epub", fileName: "blindness.epub", mimeType: "application/epub+zip", fileSize: 1536, createdAt: "2026-03-13T00:00:00.000Z", updatedAt: "2026-03-13T00:00:00.000Z", lastOpenedAt: "2026-03-13T00:00:00.000Z", progressPercent: 100, readingStatus: "finished", progress: { currentLocation: 100, totalLocations: 100, progressPercent: 100, cfi: "epubcfi(/6/2[end]!/4/2/6)", href: "epilogue.xhtml" } },
  { id: "9", title: "If on a Winter's Night a Traveler", author: "Italo Calvino", format: "epub", fileName: "if-on-a-winters-night-a-traveler.epub", mimeType: "application/epub+zip", fileSize: 1536, createdAt: "2026-03-13T00:00:00.000Z", updatedAt: "2026-03-13T00:00:00.000Z", lastOpenedAt: "2026-03-13T00:00:00.000Z", progressPercent: 100, readingStatus: "finished", progress: { currentLocation: 100, totalLocations: 100, progressPercent: 100, cfi: "epubcfi(/6/2[end]!/4/2/6)", href: "end.xhtml" } },
  { id: "10", title: "The Plague", author: "Albert Camus", format: "epub", fileName: "the-plague.epub", mimeType: "application/epub+zip", fileSize: 1536, createdAt: "2026-03-13T00:00:00.000Z", updatedAt: "2026-03-13T00:00:00.000Z", lastOpenedAt: "2026-03-13T00:00:00.000Z", progressPercent: 100, readingStatus: "finished", progress: { currentLocation: 320, totalLocations: 320, progressPercent: 100, cfi: "epubcfi(/6/2[end]!/4/2/6)", href: "end.xhtml" } },
];

const allBooks = [...currentlyReading, ...upNext, ...finished];

const meta: Meta<typeof Shelf> = {
  title: "Features/Shelf",
  component: Shelf,
  parameters: { layout: "padded" },
  args: { onSelect: () => {}, onRemove: () => {} },
};

export default meta;

type Story = StoryObj<typeof Shelf>;

/** The app default: a single unlabeled section in a grid (no status partitioning). */
export const FlatGrid: Story = {
  args: {
    layout: "grid",
    sections: [{ label: "", books: allBooks }],
  },
};

/** Grouped by reading status — an opt-in view from the shelf view menu. */
export const GroupedGrid: Story = {
  args: {
    layout: "grid",
    sections: [
      { label: "Currently Reading", books: currentlyReading },
      { label: "Up Next", books: upNext },
      { label: "Finished", books: finished },
    ],
  },
};

/** The list layout — compact rows with cover thumbnail, title/author, and progress. */
export const ListLayout: Story = {
  args: {
    layout: "list",
    sections: [{ label: "", books: allBooks }],
  },
};

/** List layout, grouped by status. */
export const GroupedList: Story = {
  args: {
    layout: "list",
    sections: [
      { label: "Currently Reading", books: currentlyReading },
      { label: "Up Next", books: upNext },
      { label: "Finished", books: finished },
    ],
  },
};
