import type { Meta, StoryObj } from "@storybook/react-vite";
import type { LibraryBook } from "../../library/lib/library-types";
import type { RegisteredReaderMode } from "../../plugins/lib/plugin-types";
import type { TocEntry } from "../lib/reader-types";
import { ReaderShellOverlay } from "./ReaderShellOverlay";

const book: LibraryBook = {
  id: "book-pale-fire",
  title: "Pale Fire",
  author: "Vladimir Nabokov",
  format: "epub",
  fileName: "pale-fire.epub",
  mimeType: "application/epub+zip",
  fileSize: 1_480_000,
  coverUrl: null,
  coverChecked: true,
  createdAt: "2026-01-02T09:00:00.000Z",
  updatedAt: "2026-06-28T19:00:00.000Z",
  lastOpenedAt: "2026-06-28T19:00:00.000Z",
  progressPercent: 62,
  readingStatus: "reading",
  progress: null,
};

const toc: TocEntry[] = [
  { id: "t1", href: "foreword.xhtml", label: "Foreword", depth: 0, spineIndex: 0, fraction: 0 },
  { id: "t2", href: "poem.xhtml", label: "Pale Fire: A Poem in Four Cantos", depth: 0, spineIndex: 1, fraction: 0.12 },
  { id: "t2a", href: "poem.xhtml#c1", label: "Canto One", depth: 1, spineIndex: 1, fraction: 0.13 },
  { id: "t2b", href: "poem.xhtml#c2", label: "Canto Two", depth: 1, spineIndex: 1, fraction: 0.2 },
  { id: "t3", href: "commentary.xhtml", label: "Commentary", depth: 0, spineIndex: 2, fraction: 0.31 },
  { id: "t4", href: "index.xhtml", label: "Index", depth: 0, spineIndex: 3, fraction: 0.94 },
];

const textUnitMode = {
  id: "sentence",
  pluginId: "sentence-reader",
  pluginName: "Sentence Reader",
  key: "sentence-reader:sentence",
  label: { default: "Sentence" },
  icon: "paragraph",
} as unknown as RegisteredReaderMode;

/**
 * The reader's chrome: the top bar over the page, with the table of contents,
 * the notes popover, appearance, and the progress scrubber.
 *
 * It is `fixed` and paints above the book, appearing and dismissing as a whole
 * — so `visible` is the story axis that matters most. Fixed-layout books hide
 * what cannot apply to them (typography, text-unit modes), which is the other
 * branch worth seeing.
 */
const meta = {
  title: "Interface/Reader/ReaderShellOverlay",
  component: ReaderShellOverlay,
  parameters: { layout: "fullscreen" },
  args: {
    visible: true,
    book,
    progress: 0.62,
    currentPage: 298,
    totalPages: 480,
    tocEntries: toc,
    currentChapterHref: "commentary.xhtml",
    readingCursor: null,
    onBack: () => {},
    onChapterSelect: () => {},
    onAnnotationSelect: () => {},
    onSeek: () => {},
    onToggleTextUnitMode: () => {},
  },
  decorators: [
    (Story) => (
      <div className="relative h-[36rem] w-full overflow-hidden bg-paper">
        <div className="px-16 py-24 font-serif text-sm leading-7 text-fg">
          <p>
            I was the shadow of the waxwing slain by the false azure in the
            windowpane; I was the smudge of ashen fluff — and I lived on, flew
            on, in the reflected sky.
          </p>
        </div>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReaderShellOverlay>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The chrome showing over a page, mid-book. */
export const Visible: Story = {};

/** Dismissed: the page is left alone. */
export const Hidden: Story = {
  args: { visible: false },
};

/** At the very start of the book. */
export const AtTheBeginning: Story = {
  args: { progress: 0, currentPage: 1, currentChapterHref: "foreword.xhtml" },
};

/** At the end. */
export const AtTheEnd: Story = {
  args: { progress: 1, currentPage: 480, currentChapterHref: "index.xhtml" },
};

/** A book whose table of contents didn't parse — the control has nothing to show. */
export const WithoutToc: Story = {
  args: { tocEntries: [], currentChapterHref: null },
};

/** A deep, nested table of contents. */
export const DeepToc: Story = {
  args: {
    tocEntries: Array.from({ length: 40 }, (_, i) => ({
      id: `d${i}`,
      href: `ch${i}.xhtml`,
      label: `${i % 4 === 0 ? "Part" : "Chapter"} ${i + 1}`,
      depth: i % 4 === 0 ? 0 : 1,
      spineIndex: i,
      fraction: i / 40,
    })),
  },
};

/**
 * A fixed-layout book (PDF, comic). Its pages cannot re-flow, so the
 * typography controls and any text-unit mode are hidden rather than disabled.
 */
export const FixedLayout: Story = {
  args: { fixedLayout: true },
};

/** A plugin contributes a text-unit mode, so its toggle appears. */
export const WithTextUnitMode: Story = {
  args: { textUnitMode },
};

/** That mode active — the toggle reads as engaged. */
export const TextUnitModeActive: Story = {
  args: { textUnitMode, textUnitModeActive: true },
};

/** No page numbers yet (the engine hasn't paginated) — the readout degrades. */
export const WithoutPageCounts: Story = {
  args: { currentPage: undefined, totalPages: undefined, progress: undefined },
};

/** A long title and author, which must not push the controls off the bar. */
export const LongTitle: Story = {
  args: {
    book: {
      ...book,
      title: "The Annals of the Former World: A Geological History of North America",
      author: "John Angus McPhee",
    },
  },
};
