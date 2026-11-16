import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import type { LibraryBook } from "../../library";
import type { MarksFilter } from "../../reader";
import { book as paleFire, chapters, sampleMarks } from "../../shelf/components/book-dialogs.fixtures";
import { groupMarksByBook } from "../lib/marks-by-book";
import type { Highlight, Note } from "../lib/annotation-types";
import { AnnotationsWorkspaceView, type AnnotationsWorkspaceViewProps } from "./AnnotationsWorkspaceView";

const walden: LibraryBook = {
  ...paleFire,
  id: "book-walden",
  title: "Walden",
  author: "Henry David Thoreau",
  coverUrl:
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='360'%3E%3Crect width='240' height='360' fill='%2365704a'/%3E%3Ctext x='20' y='52' fill='%23f5f1e8' font-family='Georgia' font-size='24'%3EWalden%3C/text%3E%3C/svg%3E",
};
const waldenMarks: (Highlight | Note)[] = [
  {
    id: "w1",
    bookId: walden.id,
    type: "highlight",
    color: "green",
    style: "underline",
    cfiRange: "epubcfi(/6/8!/4[w1])",
    chapterHref: "economy.xhtml",
    text: "The mass of men lead lives of quiet desperation.",
    createdAt: "2026-07-03T08:00:00.000Z",
    updatedAt: "2026-07-03T08:00:00.000Z",
  },
  {
    id: "w2",
    bookId: walden.id,
    type: "note",
    cfiRange: "epubcfi(/6/10!/4[w2])",
    chapterHref: "where-i-lived.xhtml",
    text: "I went to the woods because I wished to live deliberately.",
    content: "Pair with the Foreword of Pale Fire — two retreats, opposite reasons.",
    createdAt: "2026-07-01T08:00:00.000Z",
    updatedAt: "2026-07-01T08:00:00.000Z",
  },
];
/** A book removed from the library since; its marks stay. */
const removedMark: Highlight = {
  id: "r1",
  bookId: "book-gone",
  type: "highlight",
  color: "yellow",
  cfiRange: "epubcfi(/6/2!/4[r1])",
  chapterHref: null,
  text: "A passage from a book no longer on the shelf.",
  createdAt: "2026-05-01T08:00:00.000Z",
  updatedAt: "2026-05-01T08:00:00.000Z",
};
const library = [paleFire, walden];
const allBooks = groupMarksByBook([...sampleMarks, ...waldenMarks, removedMark], library);

/** The page as the container drives it: selection, filter and search live outside. */
function Interactive(props: Partial<AnnotationsWorkspaceViewProps>) {
  const [selectedBookId, setSelectedBookId] = useState<string | null>(props.selectedBookId ?? null);
  const [filter, setFilter] = useState<MarksFilter>(props.filter ?? "all");
  const [query, setQuery] = useState(props.query ?? "");
  return (
    <div className="h-[40rem] w-full bg-[var(--ra-main-surface-color)]">
      <AnnotationsWorkspaceView
        books={allBooks}
        isLoading={false}
        loadFailed={false}
        onRetry={() => {}}
        chapters={selectedBookId === paleFire.id ? chapters : []}
        onOpenPassage={() => {}}
        onDelete={() => {}}
        {...props}
        selectedBookId={selectedBookId}
        onSelectBook={setSelectedBookId}
        filter={filter}
        onFilterChange={setFilter}
        query={query}
        onQueryChange={setQuery}
      />
    </div>
  );
}

/**
 * Every book's highlights and notes on one page. The marked books run down
 * the left edge, most recently marked first, each with its count; the marks
 * take the same filters and search as a book's details, listed by book. A
 * book's heading narrows the page to it.
 */
const meta = {
  title: "Interface/Annotations/AnnotationsWorkspace",
  component: Interactive,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Interactive>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every book, grouped by book; a removed book keeps its marks under "Removed book". */
export const AllBooks: Story = {};

/** One book, grouped by its chapters, as its details dialog lists them. */
export const OneBook: Story = {
  args: { selectedBookId: paleFire.id },
};

/** Choosing a book in the list narrows the marks to it, by chapter. */
export const ChoosingABook: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(within(canvas.getByRole("navigation")).getByRole("button", { name: /^Walden/ }));
    await expect(canvas.getByRole("heading", { level: 2 })).toHaveTextContent("Walden");
    await expect(canvas.queryByText(/waxwing/)).toBeNull();
  },
};

/** Searching across every book; the counts stay the books' own. */
export const Searching: Story = {
  args: { query: "woods" },
};

/** Nothing marked yet. */
export const Empty: Story = {
  args: { books: [] },
};

/** Still reading: the counts are unknown, not zero. */
export const Loading: Story = {
  args: { books: [], isLoading: true },
};

/** The read failed: an error with a retry, never "nothing marked". */
export const Failed: Story = {
  args: { books: [], loadFailed: true, loadErrorCode: "annotations/observation-failed" },
};

/** On a phone the book list becomes a menu above the marks. */
export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
