import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import type { Annotation } from "../../annotations/lib/annotation-types";
import type { TocEntry } from "../lib/reader-types";
import { ReaderNotesPopover } from "./ReaderNotesPopover";

const toc: TocEntry[] = [
  { id: "t1", href: "foreword.xhtml", label: "Foreword", depth: 0, spineIndex: 0 },
  { id: "t2", href: "poem.xhtml", label: "Pale Fire: A Poem in Four Cantos", depth: 0, spineIndex: 1 },
  { id: "t3", href: "commentary.xhtml", label: "Commentary", depth: 0, spineIndex: 2 },
];

let seq = 0;
function highlight(chapterHref: string | null, text: string): Annotation {
  seq += 1;
  return {
    id: `h${seq}`,
    bookId: "book-1",
    type: "highlight",
    color: (["yellow", "green", "blue", "pink"] as const)[seq % 4],
    cfiRange: `epubcfi(/6/${seq}!/4/2)`,
    chapterHref,
    text,
    createdAt: "2026-06-20T10:00:00.000Z",
    updatedAt: "2026-06-20T10:00:00.000Z",
  };
}

function note(chapterHref: string | null, text: string, content: string): Annotation {
  seq += 1;
  return {
    id: `n${seq}`,
    bookId: "book-1",
    type: "note",
    content,
    cfiRange: `epubcfi(/6/${seq}!/4/2)`,
    chapterHref,
    text,
    createdAt: "2026-06-21T10:00:00.000Z",
    updatedAt: "2026-06-21T10:00:00.000Z",
  };
}

const annotations: Annotation[] = [
  highlight("poem.xhtml", "I was the shadow of the waxwing slain"),
  note("poem.xhtml", "by the false azure in the windowpane", "The mirror image again."),
  highlight("commentary.xhtml", "There is a very loud amusement park right in front of my present lodgings."),
  note("foreword.xhtml", "I have no desire to twist and batter an unambiguous apparatus criticus", "Kinbote protesting too much."),
];

/**
 * The book's marks, opened from a header icon and grouped by chapter in reading
 * order. Stories render it open, since a closed popover is just its trigger.
 *
 * The component supports both controlled and self-managed open state — the
 * navigator bar drives it from outside, the header lets it manage itself — so
 * both paths have a story.
 */
const meta = {
  title: "Interface/Reader/ReaderNotesPopover",
  component: ReaderNotesPopover,
  parameters: { layout: "centered" },
  args: {
    annotations,
    tocEntries: toc,
    open: true,
    onOpenChange: () => {},
    onNavigate: () => {},
    onDelete: () => {},
  },
} satisfies Meta<typeof ReaderNotesPopover>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Highlights and notes across three chapters, in TOC order. */
export const Grouped: Story = {};

/** Everything in one chapter — a single group, still labelled. */
export const SingleChapter: Story = {
  args: {
    annotations: [
      highlight("poem.xhtml", "A system of cells interlinked within cells interlinked"),
      highlight("poem.xhtml", "within one stem"),
    ],
  },
};

/**
 * Marks whose chapter isn't in the TOC (a stale href, a book whose TOC didn't
 * parse) fall into a trailing unlabelled group rather than disappearing.
 */
export const UngroupedRemainder: Story = {
  args: {
    annotations: [
      highlight("poem.xhtml", "I was the shadow of the waxwing slain"),
      highlight("orphan.xhtml", "A mark whose chapter is not in the table of contents"),
      highlight(null, "A mark with no chapter at all"),
    ],
  },
};

/** No marks yet: the empty line, not a bare panel. */
export const Empty: Story = {
  args: { annotations: [] },
};

/** A long list scrolls inside the panel's height cap. */
export const ManyMarks: Story = {
  args: {
    annotations: Array.from({ length: 30 }, (_, i) =>
      i % 3 === 0
        ? note("commentary.xhtml", `Marked passage number ${i + 1}`, `A note about passage ${i + 1}.`)
        : highlight(i % 2 === 0 ? "poem.xhtml" : "commentary.xhtml", `Marked passage number ${i + 1}`),
    ),
  },
};

/** Long quoted passages and long chapter labels, the layout's worst case. */
export const LongText: Story = {
  args: {
    tocEntries: [
      {
        ...toc[1],
        label: "Pale Fire: A Poem in Four Cantos, with the Commentary and Index Following",
      },
    ],
    annotations: [
      highlight(
        "poem.xhtml",
        "I was the shadow of the waxwing slain by the false azure in the windowpane; I was the smudge of ashen fluff — and I lived on, flew on, in the reflected sky.",
      ),
    ],
  },
};

/** Self-managed open state: the trigger opens it, as in the reader header. */
export const Uncontrolled: Story = {
  args: { open: undefined, onOpenChange: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Notes" }));
  },
};
