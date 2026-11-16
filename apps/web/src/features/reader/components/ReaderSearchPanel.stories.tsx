import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { bookSearchSession, type ContentsSearchState } from "../hooks/useContentsSearch";
import { writeSearchQuery } from "../lib/book-search-memory";
import ResultsStories, { AllGroups, ManyHits, NoTextHits } from "./ReaderContentsResults.stories";
import { ReaderSearchPanel } from "./ReaderSearchPanel";

/** The results fixtures: a Chinese novel's contents and its text hits for 红岸. */
const { entries, query, search } = ResultsStories.args;
const bookmarks = AllGroups.args?.matches?.bookmarks ?? [];
const marks = AllGroups.args?.matches?.marks ?? [];
const bookId = "book-1";

/** A sibling story's search state, which those stories always set. */
function storySearch(state: ContentsSearchState | undefined): ContentsSearchState {
  if (!state) throw new Error("The ReaderContentsResults story fixture lost its search state");
  return state;
}
const longSearch = storySearch(ManyHits.args?.search);
const noTextSearch = storySearch(NoTextHits.args?.search);

/**
 * Leave the book search as a reader left it in this book, through the same
 * memory a real reopening reads: the query in local KV (as the field stores
 * it once typing settles) and, for this run of the app, what it found and
 * the chapter names its text hits sit under. An empty query is a book whose
 * search was cleared. Nothing else can feed the panel: an unremembered query
 * searches the book's text, which needs the desktop app. Resolves to the
 * cleanup that forgets all of it, so the next story starts afresh.
 *
 * Used by the sheet and shell stories too; `excludeStories` keeps it out of
 * the story list.
 */
export async function rememberBookSearch(
  book: string,
  { query, search, topRow }: { query: string; search: ContentsSearchState; topRow?: string },
): Promise<() => Promise<void>> {
  bookSearchSession.clear();
  await writeSearchQuery(book, query);
  const { chapterOf, ...found } = search;
  if (chapterOf) bookSearchSession.chapters.set(book, chapterOf);
  if (query) bookSearchSession.results.set(book, query, found);
  if (query && topRow) bookSearchSession.place.set(book, query, topRow);
  return async () => {
    bookSearchSession.clear();
    await writeSearchQuery(book, "");
  };
}

/**
 * Search everything in the open book: chapters, printed pages, bookmarks,
 * highlights and notes, then the text. It opens as a popup under the header's
 * search button (a dialog when that button sits in "More", a sheet on a
 * phone) and reopens on the last query searched in the book, with its results
 * at the place the list was left. Rendered in the popup's box, which bounds
 * its height; the results scroll inside.
 */
const meta = {
  title: "Interface/Reader/ReaderSearchPanel",
  component: ReaderSearchPanel,
  excludeStories: ["rememberBookSearch"],
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="flex h-[36rem] w-[28rem] flex-col overflow-hidden rounded-md border border-border bg-[var(--ra-main-surface-color)]">
        <Story />
      </div>
    ),
  ],
  args: {
    bookId,
    shown: true,
    entries,
    annotations: marks,
    bookmarks,
    className: "min-h-0 flex-1",
    onClose: fn(),
    onChapterSelect: fn(),
    onAnnotationSelect: fn(),
    onBookmarkSelect: fn(async () => true),
    onJumped: fn(),
  },
} satisfies Meta<typeof ReaderSearchPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Nothing searched in this book yet: an empty field, focused. Escape on it
 * closes the search.
 */
export const Empty: Story = {
  beforeEach: () => rememberBookSearch(bookId, { query: "", search }),
  play: async ({ canvasElement, args }) => {
    const field = await within(canvasElement).findByRole("searchbox", { name: "Search this book" });
    await waitFor(() => expect(field).toHaveFocus());
    await expect(field).toHaveValue("");
    await userEvent.keyboard("{Escape}");
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

/**
 * Reopened on the query last searched in this book: the field is focused with
 * its text selected, ready to be replaced, over the same results — chapters,
 * the reader's bookmarks and marks, then the text under its chapters —
 * without searching the book again.
 */
export const Remembered: Story = {
  beforeEach: () => rememberBookSearch(bookId, { query, search }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const field = await canvas.findByRole("searchbox", { name: "Search this book" });
    await expect(field).toHaveValue(query);
    await waitFor(() => expect(field).toHaveFocus());
    await expect(await canvas.findByText("Chapters")).toBeVisible();
    await expect(await canvas.findByText("Text")).toBeVisible();
  },
};

// A text hit well down the list (the remembered place is a row key).
const resumedHit = longSearch.text.status === "idle" ? undefined : longSearch.text.hits[24];

/**
 * A long result list reopens at the row that was at its top when the search
 * was closed, not at the start.
 */
export const ReopensWhereItWasLeft: Story = {
  beforeEach: () =>
    rememberBookSearch(bookId, { query, search: longSearch, topRow: resumedHit && `t:${resumedHit.id}` }),
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole("searchbox", { name: "Search this book" });
    // The list's own scroller has moved down to the remembered row.
    await waitFor(() => expect(canvasElement.querySelector(".ra-scrollarea")?.scrollTop).toBeGreaterThan(0));
  },
};

/** The query is nowhere in the book: no chapter, mark or text answers it. */
export const NoResults: Story = {
  beforeEach: () => rememberBookSearch(bookId, { query: "智子", search: noTextSearch }),
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("No matches for “智子” in the text.")).toBeVisible();
  },
};

/**
 * A book with no text layer (a scanned PDF): chapters and marks still answer,
 * the text cannot be searched, and the list says so.
 */
export const TextlessBook: Story = {
  beforeEach: () =>
    rememberBookSearch(bookId, {
      query,
      search: {
        ...noTextSearch,
        text:
          noTextSearch.text.status === "done" ? { ...noTextSearch.text, textStatus: "textless" } : noTextSearch.text,
      },
    }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Chapters")).toBeVisible();
    await expect(await canvas.findByText("This book has no searchable text — its pages may be images.")).toBeVisible();
  },
};

/**
 * As the phone sheet and the "More" dialog host it: a Cancel button beside
 * the field. The phone leaves a remembered query unfocused, so the keyboard
 * does not cover its results.
 */
export const WithCancel: Story = {
  args: { showCancel: true, focusRestored: false },
  beforeEach: () => rememberBookSearch(bookId, { query, search }),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const field = await canvas.findByRole("searchbox", { name: "Search this book" });
    await expect(field).toHaveValue(query);
    await expect(field).not.toHaveFocus();
    await userEvent.click(canvas.getByRole("button", { name: "Cancel" }));
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};
