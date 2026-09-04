import type { Meta, StoryObj } from "@storybook/react-vite";
import { readingStatsAtom } from "../../../state/ui";
import { seed, withAtoms } from "../../../story-support/atoms";
import type { Annotation } from "../../annotations/lib/annotation-types";
import type { LibraryBook } from "../../library/lib/library-types";
import { emptyHourBuckets } from "../lib/reading-stats";
import { ReaderCompletionScreenView } from "./ReaderCompletionScreenView";

const book: LibraryBook = {
  id: "book-pale-fire",
  title: "Pale Fire",
  author: "Vladimir Nabokov",
  format: "epub",
  fileName: "pale-fire.epub",
  mimeType: "application/epub+zip",
  fileSize: 1_480_000,
  coverUrl: null,
  coverStatus: "none",
  coverBlobKey: null,
  coverLocal: false,
  coverVersion: null,
  createdAt: "2026-01-02T09:00:00.000Z",
  updatedAt: "2026-06-28T19:00:00.000Z",
  lastOpenedAt: "2026-06-28T19:00:00.000Z",
  progressPercent: 100,
  readingStatus: "finished",
  progress: null,
};

/** A month of evening reading, so the summary sentence has real figures. */
const readingHistory = withAtoms(
  seed(readingStatsAtom, {
    [book.id]: {
      bookId: book.id,
      firstStartedAt: Date.UTC(2026, 4, 20),
      lastReadAt: Date.UTC(2026, 5, 28),
      totalMs: 15_120_000,
      daily: Object.fromEntries(
        Array.from({ length: 22 }, (_, i) => {
          const day = new Date(2026, 5, 28 - i);
          const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
          return [key, (25 + ((i * 7) % 40)) * 60_000];
        }),
      ),
      byHour: emptyHourBuckets(),
    },
  }),
);

let seq = 0;
function mark(text: string, note?: string): Annotation {
  seq += 1;
  const base = {
    id: `m${seq}`,
    bookId: book.id,
    cfiRange: `epubcfi(/6/${seq}!/4/2)`,
    chapterHref: "poem.xhtml",
    text,
    createdAt: "2026-06-20T10:00:00.000Z",
    updatedAt: "2026-06-20T10:00:00.000Z",
  };
  return note
    ? { ...base, type: "note", content: note }
    : { ...base, type: "highlight", color: "yellow" };
}

const marks: Annotation[] = [
  mark("I was the shadow of the waxwing slain by the false azure in the windowpane."),
  mark("And from the inside, too, I'd duplicate myself", "The doubling starts early."),
  mark("A system of cells interlinked within cells interlinked within one stem"),
];

/**
 * The last page of a book.
 *
 * It lives inside the reader, so it takes the READING theme's palette rather
 * than the app canvas — coming off the last page onto a different colour reads
 * as a glitch. Every story therefore names a theme, and the dark and light ones
 * are worth looking at side by side.
 *
 * The marks are the substance of the screen; the container loads them and hands
 * them in, which is why they can be varied here.
 */
const meta = {
  title: "Interface/Reader/ReaderCompletionScreen",
  component: ReaderCompletionScreenView,
  parameters: { layout: "fullscreen" },
  args: {
    book,
    marks,
    theme: "warm",
    visible: true,
    shellVisible: false,
    finished: false,
    lookBackAsked: false,
    onFinishedChange: () => {},
    onRevisit: () => {},
    onCloseReader: () => {},
    onTapPage: () => {},
    onLookBackAsked: () => {},
    onDismiss: () => {},
  },
  decorators: [
    readingHistory,
    (Story) => (
      <div className="relative h-[46rem] w-full overflow-hidden">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReaderCompletionScreenView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The warm reading palette, with marks and the book not yet marked finished. */
export const Warm: Story = {};

/** The light palette. */
export const Light: Story = {
  args: { theme: "light" },
};

/** The dark palette — the whole screen inverts, including the buttons. */
export const Dark: Story = {
  args: { theme: "dark" },
};

/** Already marked finished: the primary button becomes a solid, filled state. */
export const MarkedFinished: Story = {
  args: { finished: true },
};

/**
 * A book read without marking anything. The marks section is not rendered at
 * all rather than showing an empty heading.
 */
export const NoMarks: Story = {
  args: { marks: [] },
};

/** The marks are still loading — same treatment as none, never a flash. */
export const MarksLoading: Story = {
  args: { marks: null },
};

/** A heavily marked book, where the list carries the page. */
export const ManyMarks: Story = {
  args: {
    marks: Array.from({ length: 14 }, (_, i) =>
      mark(
        `Marked passage number ${i + 1}, quoted at about the length a real highlight runs to.`,
        i % 4 === 0 ? "And a note attached to it." : undefined,
      ),
    ),
  },
};

/** Marks with no anchor can't be revisited; the row stays but is inert. */
export const UnanchoredMarks: Story = {
  args: {
    marks: marks.map((entry) => ({ ...entry, cfiRange: null })),
  },
};

/**
 * The reader's top bar is showing. It is `fixed` and paints over this screen,
 * so the close button steps down out from under it.
 */
export const WithShellVisible: Story = {
  args: { shellVisible: true },
};

/** Opened from a context with no shelf to return to: no back affordance. */
export const WithoutShelf: Story = {
  args: { onCloseReader: undefined },
};

/**
 * A look back was already asked this session, so the button reveals the
 * existing answer instead of asking the same question again.
 */
export const LookBackAlreadyAsked: Story = {
  args: { lookBackAsked: true },
};

/** Dismissing: the exit animation, which the parent keeps mounted until done. */
export const Dismissing: Story = {
  args: { visible: false },
};

/** A book with no author recorded — the byline is dropped, not left blank. */
export const WithoutAuthor: Story = {
  args: { book: { ...book, author: "" } },
};

/** A long title, which has to wrap rather than overflow the column. */
export const LongTitle: Story = {
  args: {
    book: {
      ...book,
      title: "The Annals of the Former World: A Geological History of North America",
    },
  },
};
