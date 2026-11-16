import { useEffect, type ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReadingLocation } from "@read-aware/core";
import { PHONE_VIEWPORT_QUERY } from "@read-aware/ui/media";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { readingRuntime } from "../../../domain/reading-runtime";
import type { ReadingEngineAdapter } from "../../../domain/reading-session-controller";
import type { LibraryBook } from "../../library/lib/library-types";
import type { RegisteredReaderMode } from "../../plugins/lib/plugin-types";
import { useReaderControls } from "../hooks/useReaderControls";
import { DEFAULT_PANEL_LAYOUT, updateReaderPanelLayout } from "../lib/reader-panel-layout";
import type { TocEntry } from "../lib/reader-types";
import { BUILTIN_READER_PALETTES } from "../../settings/lib/reader-theme";
import ResultsStories from "./ReaderContentsResults.stories";
import { rememberBookSearch } from "./ReaderSearchPanel.stories";
import { ReaderShellOverlay } from "./ReaderShellOverlay";

/** The book page's own colour, from the default reading theme — the reader
    takes its palette from the reading theme, never from an app token. */
const page = BUILTIN_READER_PALETTES.warm;

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

const text = (value: string) => ({ default: value });
const textUnitMode: RegisteredReaderMode = {
  id: "sentence",
  pluginId: "sentence-reader",
  pluginName: "Sentence Reader",
  key: "sentence-reader:sentence",
  kind: "text-unit-navigator",
  icon: "paragraph",
  units: [
    {
      id: "sentence",
      label: text("By sentence"),
      previousLabel: text("Previous sentence"),
      nextLabel: text("Next sentence"),
    },
    {
      id: "paragraph",
      label: text("By paragraph"),
      previousLabel: text("Previous paragraph"),
      nextLabel: text("Next paragraph"),
      icon: "paragraph",
    },
  ],
  defaultUnitId: "sentence",
  copy: {
    title: text("Read by sentence or paragraph"),
    enable: text("Start reading by sentence or paragraph"),
    exit: text("Exit reading by sentence or paragraph"),
    returnToCurrent: text("Back to current sentence"),
    showToolbars: text("Show toolbars"),
    moreActions: text("More actions"),
    collapseActions: text("Collapse actions"),
    menuLabel: text("Sentence navigator"),
    shortcuts: {
      description: text("Active while reading by sentence or paragraph."),
      volumeKeys: text("Step with volume keys"),
    },
  },
  segmentText: ({ text: source }) => [{ start: 0, end: source.length }],
};

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
      <div className="relative h-[36rem] w-full overflow-hidden" style={{ backgroundColor: page.bg, color: page.text }}>
        <div className="px-16 py-24 font-serif text-sm leading-7">
          <p>
            I was the shadow of the waxwing slain by the false azure in the windowpane; I was the smudge of ashen fluff
            — and I lived on, flew on, in the reflected sky.
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

/**
 * Phone width: the top keeps back, the title with chapter and percentage, and
 * "More", with the progress line on its edge (drag sideways across the bar to
 * scrub); the actions move to a bottom toolbar within thumb reach.
 */
export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};

/** Phone width with a text-unit mode: more actions than fit fold into "More". */
export const PhoneWithTextUnitMode: Story = {
  ...Phone,
  args: { ...WithTextUnitMode.args },
};

/**
 * The book open in a reading session, as the reader workspace runs one: the
 * side panels and phone sheets open through the reader's panel service, which
 * acts only on a ready session with the shell's controls bound to it. The
 * session here has no engine behind it — the page stays where it is — and
 * ends with the story.
 */
function OpenBook(props: ComponentProps<typeof ReaderShellOverlay>) {
  const { book, currentChapterHref, progress } = props;
  const { controls, visible, setVisible } = useReaderControls();
  useEffect(() => {
    const sessionId = readingRuntime.begin(book.id);
    const unbindControls = readingRuntime.bindControls(sessionId, controls);
    const location: ReadingLocation = {
      bookId: book.id,
      contentVersion: "story",
      ...(currentChapterHref ? { href: currentChapterHref } : {}),
      ...(progress != null ? { fraction: progress } : {}),
    };
    const engine: ReadingEngineAdapter = { navigate: async () => location, step: async () => location };
    readingRuntime.attach(sessionId, engine, location);
    setVisible(true);
    return () => {
      unbindControls();
      readingRuntime.closed();
    };
  }, [book.id, controls, currentChapterHref, progress, setVisible]);
  return <ReaderShellOverlay {...props} visible={visible} />;
}

/** The docked contents panel is remembered per book: each story starts with it closed. */
const panelBook: LibraryBook = { ...book, id: "story-reader-panels" };
const closedPanels = async () => {
  await updateReaderPanelLayout(panelBook.id, () => DEFAULT_PANEL_LAYOUT);
  return async () => {
    await updateReaderPanelLayout(panelBook.id, () => DEFAULT_PANEL_LAYOUT);
  };
};

/** A header (or phone toolbar) button, once the chrome has come in and takes clicks. */
async function control(canvasElement: HTMLElement, name: string) {
  const button = await within(canvasElement).findByRole("button", { name });
  await waitFor(() => expect(button.closest("[inert]")).toBeNull());
  return button;
}

/**
 * The phone stories need the phone layout, which follows the window's width:
 * Storybook's "Small mobile" viewport (the `Phone` globals) gives it; a
 * standalone iframe at desktop width does not.
 */
async function phoneWidth(canvasElement: HTMLElement) {
  const view = canvasElement.ownerDocument.defaultView;
  await expect(view?.matchMedia(PHONE_VIEWPORT_QUERY).matches, "rendered at phone width").toBe(true);
}

/** The side panel showing `name` — open, not just mounted off-screen. */
async function openSidePanel(canvasElement: HTMLElement, name: string) {
  const panel = await within(canvasElement).findByRole("region", { name });
  await waitFor(() => expect(panel).not.toHaveAttribute("inert"));
  return panel;
}

/**
 * The contents, from the header's contents button: the one left panel, on the
 * contents view with the current chapter marked.
 */
export const ContentsPanel: Story = {
  args: { book: panelBook },
  render: (args) => <OpenBook {...args} />,
  beforeEach: closedPanels,
  play: async ({ canvasElement }) => {
    const toggle = await control(canvasElement, "Table of contents");
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-pressed", "true"));
    const panel = await openSidePanel(canvasElement, "Table of contents");
    await expect(within(panel).getByRole("button", { name: "Commentary" })).toHaveAttribute("aria-current", "location");
  },
};

/**
 * The book's notes, from the header's notes button: the same left panel on its
 * notes view. The browser build has no library store, so the book has no
 * bookmarks, highlights or notes here and the view shows its empty line; the
 * populated list is in ReaderContentsPanel's stories.
 */
export const NotesPanel: Story = {
  args: { book: panelBook },
  render: (args) => <OpenBook {...args} />,
  beforeEach: closedPanels,
  play: async ({ canvasElement }) => {
    const toggle = await control(canvasElement, "Notes");
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-pressed", "true"));
    const panel = await openSidePanel(canvasElement, "Notes");
    const empty = within(panel).getByText(
      "No bookmarks, highlights or notes yet. Select text to mark it, or bookmark a page.",
    );
    // Visible once the panel has slid in.
    await waitFor(() => expect(empty).toBeVisible());
  },
};

/**
 * Contents, then notes: the panel switches view in place rather than sliding
 * shut between the two, and only the notes button reads as pressed.
 */
export const SwitchingViews: Story = {
  args: { book: panelBook },
  render: (args) => <OpenBook {...args} />,
  beforeEach: closedPanels,
  play: async ({ canvasElement }) => {
    const contents = await control(canvasElement, "Table of contents");
    await userEvent.click(contents);
    await openSidePanel(canvasElement, "Table of contents");
    const notes = await control(canvasElement, "Notes");
    await userEvent.click(notes);
    await openSidePanel(canvasElement, "Notes");
    await waitFor(() => expect(contents).toHaveAttribute("aria-pressed", "false"));
    await expect(notes).toHaveAttribute("aria-pressed", "true");
  },
};

/** The ReaderContentsResults fixtures: a Chinese novel searched for 红岸. */
const { entries: searchToc, query: searchQuery, search: searchResults } = ResultsStories.args;
const searchBook: LibraryBook = { ...book, id: "book-1", title: "三体", author: "刘慈欣" };

/**
 * The book search, from the header's search button: a popup under the button
 * that reopens on the last query searched in this book, results and all.
 */
export const SearchPopup: Story = {
  args: { book: searchBook, tocEntries: searchToc, currentChapterHref: "part1.xhtml" },
  beforeEach: () => rememberBookSearch(searchBook.id, { query: searchQuery, search: searchResults }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = await control(canvasElement, "Search this book");
    await userEvent.click(trigger);
    const field = await canvas.findByRole("searchbox", { name: "Search this book" });
    await expect(field).toHaveValue(searchQuery);
    await expect(await canvas.findByText("Chapters")).toBeVisible();
  },
};

/** Phone width: the contents rise in a tall sheet from the bottom toolbar's button. */
export const PhoneContentsSheet: Story = {
  ...Phone,
  args: { book: panelBook },
  render: (args) => <OpenBook {...args} />,
  beforeEach: closedPanels,
  play: async ({ canvasElement }) => {
    await phoneWidth(canvasElement);
    await userEvent.click(await control(canvasElement, "Table of contents"));
    const sheet = await within(canvasElement).findByRole("dialog", { name: "Table of contents" });
    await expect(within(sheet).getByRole("button", { name: "Commentary" })).toHaveAttribute("aria-current", "location");
  },
};

/** Phone width: the notes in the same tall sheet (empty here; see NotesPanel). */
export const PhoneNotesSheet: Story = {
  ...Phone,
  args: { book: panelBook },
  render: (args) => <OpenBook {...args} />,
  beforeEach: closedPanels,
  play: async ({ canvasElement }) => {
    await phoneWidth(canvasElement);
    await userEvent.click(await control(canvasElement, "Notes"));
    const sheet = await within(canvasElement).findByRole("dialog", { name: "Notes" });
    await expect(
      within(sheet).getByText("No bookmarks, highlights or notes yet. Select text to mark it, or bookmark a page."),
    ).toBeVisible();
  },
};

/**
 * Phone width: the search in a tall sheet with Cancel, where a popup would
 * open under the keyboard. The remembered query is left unfocused so the
 * keyboard does not cover its results.
 */
export const PhoneSearchSheet: Story = {
  ...Phone,
  args: SearchPopup.args,
  beforeEach: SearchPopup.beforeEach,
  play: async ({ canvasElement }) => {
    await phoneWidth(canvasElement);
    await userEvent.click(await control(canvasElement, "Search this book"));
    const sheet = await within(canvasElement).findByRole("dialog", { name: "Search this book" });
    const field = within(sheet).getByRole("searchbox", { name: "Search this book" });
    await expect(field).toHaveValue(searchQuery);
    await expect(field).not.toHaveFocus();
    await expect(within(sheet).getByRole("button", { name: "Cancel" })).toBeVisible();
  },
};
