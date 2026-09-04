import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Annotation } from "../../annotations/lib/annotation-types";
import type { LibraryBook } from "../../library/lib/library-types";
import { AnnotationsPopoverView } from "./AnnotationsPopoverView";

function book(id: string, title: string, author: string): LibraryBook {
  return {
    id,
    title,
    author,
    format: "epub",
    fileName: `${id}.epub`,
    mimeType: "application/epub+zip",
    fileSize: 1_200_000,
    coverStatus: "none",
    coverBlobKey: null,
    coverLocal: false,
    coverVersion: null,
    coverUrl: null,
    createdAt: "2026-01-02T09:00:00.000Z",
    updatedAt: "2026-06-28T19:00:00.000Z",
    lastOpenedAt: "2026-06-28T19:00:00.000Z",
    progressPercent: 40,
    readingStatus: "reading",
    progress: null,
  };
}

const books: LibraryBook[] = [
  book("book-pale-fire", "Pale Fire", "Vladimir Nabokov"),
  book("book-tractatus", "Tractatus Logico-Philosophicus", "Ludwig Wittgenstein"),
];

let seq = 0;
function entry(bookId: string, type: Annotation["type"], text: string, content = ""): Annotation {
  seq += 1;
  const base = {
    id: `a${seq}`,
    bookId,
    cfiRange: `epubcfi(/6/${seq}!/4/2)`,
    chapterHref: "chapter-1.xhtml",
    text,
    createdAt: "2026-06-20T10:00:00.000Z",
    updatedAt: "2026-06-20T10:00:00.000Z",
  };
  if (type === "note") return { ...base, type: "note", content };
  if (type === "ask") return { ...base, type: "ask" };
  return { ...base, type: "highlight", color: "yellow" };
}

const annotations: Annotation[] = [
  entry("book-pale-fire", "highlight", "I was the shadow of the waxwing slain"),
  entry("book-pale-fire", "note", "by the false azure in the windowpane", "The mirror image again."),
  entry("book-pale-fire", "ask", "Who is Kinbote, really?"),
  entry("book-tractatus", "highlight", "Whereof one cannot speak, thereof one must be silent."),
];

/**
 * Cross-book annotation browsing, as a header popover — the Agent page's
 * counterpart to the reader's own notes popover, and deliberately the same
 * interaction and row styling.
 *
 * Marks are grouped by book; the book title and any row inside it both jump
 * back into that book.
 */
const meta = {
  title: "Interface/Agent/AnnotationsPopover",
  component: AnnotationsPopoverView,
  parameters: { layout: "centered" },
  args: {
    books,
    annotations,
    open: true,
    onOpenChange: () => {},
    onOpenBook: () => {},
    onDelete: () => {},
  },
} satisfies Meta<typeof AnnotationsPopoverView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Highlights, notes and asks across two books. */
export const Grouped: Story = {};

/** Everything from one book — a single group. */
export const SingleBook: Story = {
  args: { annotations: annotations.slice(0, 3) },
};

/**
 * A mark whose book is no longer in the library. The group still renders,
 * under a fallback title, instead of vanishing with the book.
 */
export const UnknownBook: Story = {
  args: { books: [books[0]] },
};

/** Nothing marked anywhere yet. */
export const Empty: Story = {
  args: { annotations: [] },
};

/** A large collection, which scrolls inside the panel's cap. */
export const ManyAnnotations: Story = {
  args: {
    annotations: Array.from({ length: 30 }, (_, i) =>
      entry(
        i % 2 === 0 ? "book-pale-fire" : "book-tractatus",
        i % 3 === 0 ? "note" : "highlight",
        `Marked passage number ${i + 1}`,
        "A note about it.",
      ),
    ),
  },
};

/** Closed — the trigger alone, as it sits in the header. */
export const Closed: Story = {
  args: { open: false },
};
