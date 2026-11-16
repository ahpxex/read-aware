import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { ReaderContentsPanel } from "./ReaderContentsPanel";
import NotesStories from "./ReaderNotesList.stories";
import OverlayStories from "./ReaderShellOverlay.stories";

/** Pale Fire, as the shell stories open it: its contents and current chapter. */
const toc = OverlayStories.args.tocEntries;
const commentary = toc.findIndex((entry) => entry.href === OverlayStories.args.currentChapterHref);

/** The notes list fixtures — highlights, notes and a bookmark in Pale Fire. */
const notes = {
  ...NotesStories.args,
  tocEntries: toc,
  onNavigate: fn(),
  onDelete: fn(),
  onRetryLoad: fn(),
  bookmarks: { ...NotesStories.args.bookmarks, onOpen: fn(), onRename: fn(), onRemove: fn() },
};

/**
 * The reader's one left panel, docked beside the page: the table of contents
 * or the book's notes (bookmarks, highlights and notes in one list), each
 * chosen by its own header button. On a phone the same content fills a tall
 * sheet (see ReaderSheet). Rendered at the docked panel's width and height.
 */
const meta = {
  title: "Interface/Reader/ReaderContentsPanel",
  component: ReaderContentsPanel,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="flex h-[36rem] w-72 flex-col border-r border-border-strong/70 bg-[var(--ra-main-surface-color)]">
        <Story />
      </div>
    ),
  ],
  args: {
    bookId: "story-contents-panel",
    shown: true,
    view: "contents",
    entries: toc,
    activeIndex: commentary,
    notes,
    onChapterSelect: fn(),
  },
} satisfies Meta<typeof ReaderContentsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The contents view: the book's contents, the current chapter marked. */
export const Contents: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const current = await canvas.findByRole("button", { name: "Commentary" });
    await expect(current).toHaveAttribute("aria-current", "location");
    await userEvent.click(canvas.getByRole("button", { name: "Index" }));
    await expect(args.onChapterSelect).toHaveBeenCalledWith("index.xhtml");
  },
};

/** The current chapter inside a branch: the branch opens on the way to it. */
export const ContentsInsideBranch: Story = {
  args: { activeIndex: toc.findIndex((entry) => entry.label === "Canto Two") },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole("button", { name: "Canto Two" })).toHaveAttribute(
      "aria-current",
      "location",
    );
  },
};

/** A file without navigable contents. */
export const ContentsUnavailable: Story = {
  args: { entries: [], activeIndex: -1 },
};

/**
 * The notes view: the bookmark among the highlights and notes, grouped by
 * chapter in reading order.
 */
export const Notes: Story = {
  args: { view: "notes" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("button", { name: /^Canto Two/ })).toBeVisible();
    await expect(canvas.getByText("Commentary")).toBeVisible();
  },
};

/** Nothing marked yet: the empty line says how to add something. */
export const NotesEmpty: Story = {
  args: { view: "notes", notes: { ...notes, annotations: [], bookmarks: { ...notes.bookmarks, bookmarks: [] } } },
};

/** The book's marks are still being read. */
export const NotesLoading: Story = {
  args: { view: "notes", notes: { ...notes, isLoading: true, bookmarks: { ...notes.bookmarks, bookmarks: null } } },
};

/**
 * Reading the highlights and notes failed: an error with its retry, never
 * "nothing yet". The bookmarks, read separately, still show.
 */
export const NotesFailed: Story = {
  args: {
    view: "notes",
    notes: { ...notes, annotations: [], loadFailed: true, loadErrorCode: "annotations/observation-failed" },
  },
};

/** Reading the bookmarks failed: said in place, the highlights and notes still listed. */
export const BookmarksFailed: Story = {
  args: { view: "notes", notes: { ...notes, bookmarks: { ...notes.bookmarks, bookmarks: null, failed: true } } },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("Bookmarks could not be loaded.")).toBeVisible();
  },
};
