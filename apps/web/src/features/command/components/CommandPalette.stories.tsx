import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Collection, LibraryBook } from "../../library/lib/library-types";
import type { CommandContext } from "../lib/build-commands";
import { CommandPalette } from "./CommandPalette";

const noop = () => {};

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

const books: LibraryBook[] = [
  {
    ...base,
    id: "1",
    title: "The Master and Margarita",
    author: "Mikhail Bulgakov",
    fileName: "the-master-and-margarita.epub",
    lastOpenedAt: "2026-07-06T09:00:00.000Z",
    progressPercent: 64,
    readingStatus: "reading",
    collectionId: "c1",
  },
  {
    ...base,
    id: "2",
    title: "Thinking, Fast and Slow",
    author: "Daniel Kahneman",
    fileName: "thinking-fast-and-slow.epub",
    lastOpenedAt: "2026-07-01T20:00:00.000Z",
    progressPercent: 23,
    readingStatus: "reading",
  },
  {
    ...base,
    id: "3",
    title: "Invisible Cities",
    author: "Italo Calvino",
    fileName: "invisible-cities.epub",
    collectionId: "c2",
  },
  {
    ...base,
    id: "4",
    title: "The Periodic Table",
    author: "Primo Levi",
    format: "pdf",
    fileName: "the-periodic-table.pdf",
    mimeType: "application/pdf",
  },
];

const collections: Collection[] = [
  { id: "c1", name: "Russian classics", createdAt: "2026-05-01T00:00:00.000Z" },
  { id: "c2", name: "To read next", createdAt: "2026-06-12T00:00:00.000Z" },
];

/** Shelf-at-rest context: default view, two collections, a small library. */
const ctx: CommandContext = {
  activeTopNav: "shelf",
  shelfView: { layout: "grid", group: "none", sort: "recent" },
  collections,
  books,
  openBook: noop,
  openCollection: noop,
  goShelf: noop,
  goContext: noop,
  goStats: noop,
  openSettings: noop,
  importBook: noop,
  startSelection: noop,
  setLayout: noop,
  setSort: noop,
  setGroup: noop,
};

const meta = {
  title: "Interface/Command/CommandPalette",
  component: CommandPalette,
  parameters: { layout: "fullscreen" },
  args: {
    isOpen: true,
    onClose: () => {},
    ctx,
  },
} satisfies Meta<typeof CommandPalette>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The empty-query default: sections in fixed order — navigation, shelf
    controls, both collections, and the most recently opened books. The query is
    internal state (reset on every open), so a pre-typed variant can't be
    expressed via props; type in the canvas to see ranking. */
export const Default: Story = {};
