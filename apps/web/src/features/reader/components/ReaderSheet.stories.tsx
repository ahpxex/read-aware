import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { readerOverridesAtom, readerPreferencesAtom } from "../../../state/ui";
import { seed, withAtoms } from "../../../story-support/atoms";
import { DEFAULT_READER_PREFERENCES } from "../../settings/lib/reader-settings";
import { BUILTIN_READER_PALETTES } from "../../settings/lib/reader-theme";
import ContentsPanelStories from "./ReaderContentsPanel.stories";
import ResultsStories from "./ReaderContentsResults.stories";
import { ReaderAppearanceCompact } from "./ReaderAppearanceCompact";
import { ReaderContentsPanel, type ReaderSideView } from "./ReaderContentsPanel";
import SearchPanelStories, { rememberBookSearch } from "./ReaderSearchPanel.stories";
import { ReaderSearchPanel } from "./ReaderSearchPanel";
import { ReaderSheet, type ReaderSheetContent } from "./ReaderSheet";

type PhoneSheet = ReaderSideView | "search" | "appearance";

/** The side panel's and the search's own story fixtures. */
const panel = ContentsPanelStories.args;
const search = SearchPanelStories.args;
/** What the search found for 红岸, remembered for the search sheet. */
const remembered = { query: ResultsStories.args.query, search: ResultsStories.args.search };

/** What each sheet holds, as the reader shell fills them on a phone. */
function sheet(key: PhoneSheet): ReaderSheetContent {
  switch (key) {
    case "search":
      return {
        title: "Search this book",
        tall: true,
        body: <ReaderSearchPanel {...search} className="min-h-0 flex-1" showCancel focusRestored={false} />,
      };
    case "appearance":
      return {
        title: "Reading appearance",
        body: (
          <div className="min-h-0 overflow-y-auto px-4 pb-5 pt-1">
            <ReaderAppearanceCompact bookId="book-pale-fire" />
          </div>
        ),
      };
    default:
      return {
        title: key === "notes" ? "Notes" : "Table of contents",
        tall: true,
        body: <ReaderContentsPanel {...panel} view={key} />,
      };
  }
}

const page = BUILTIN_READER_PALETTES.warm;

/**
 * A phone reader sheet rising from the bottom edge: the contents, the notes
 * and the book search in a tall sheet that takes the screen below the status
 * bar, appearance in a short one (when the toolbar sits at the top). One
 * shows at a time; it closes by pulling it down, swiping it left, a tap
 * beside it, or Escape. Rendered in a phone-sized frame over a page.
 */
const meta = {
  title: "Interface/Reader/ReaderSheet",
  component: ReaderSheet<PhoneSheet>,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div
        className="relative mx-auto h-dvh w-full max-w-[24rem] overflow-hidden"
        style={{ backgroundColor: page.bg, color: page.text }}
      >
        <p className="px-6 py-16 font-serif text-sm leading-7">
          I was the shadow of the waxwing slain by the false azure in the windowpane; I was the smudge of ashen fluff —
          and I lived on, flew on, in the reflected sky.
        </p>
        <Story />
      </div>
    ),
  ],
  args: { active: "contents", render: sheet, onClose: fn() },
} satisfies Meta<typeof ReaderSheet<PhoneSheet>>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The contents in a tall sheet. Escape (or a tap beside it) asks it to close. */
export const Contents: Story = {
  play: async ({ canvasElement, args }) => {
    const sheetDialog = await within(canvasElement).findByRole("dialog", { name: "Table of contents" });
    await expect(within(sheetDialog).getByRole("button", { name: "Commentary" })).toHaveAttribute(
      "aria-current",
      "location",
    );
    within(sheetDialog).getByRole("button", { name: "Commentary" }).focus();
    await userEvent.keyboard("{Escape}");
    await expect(args.onClose).toHaveBeenCalled();
  },
};

/** The book's notes in the same tall sheet. */
export const Notes: Story = {
  args: { active: "notes" },
  play: async ({ canvasElement }) => {
    const sheetDialog = await within(canvasElement).findByRole("dialog", { name: "Notes" });
    await expect(await within(sheetDialog).findByRole("button", { name: /^Canto Two/ })).toBeVisible();
  },
};

/**
 * The book search, reopened on its remembered query: a Cancel button beside
 * the field, which is left unfocused so the keyboard does not cover the
 * results.
 */
export const Search: Story = {
  args: { active: "search" },
  beforeEach: () => rememberBookSearch(search.bookId, remembered),
  play: async ({ canvasElement }) => {
    const sheetDialog = await within(canvasElement).findByRole("dialog", { name: "Search this book" });
    const field = within(sheetDialog).getByRole("searchbox", { name: "Search this book" });
    await expect(field).toHaveValue(remembered.query);
    await expect(field).not.toHaveFocus();
    await expect(await within(sheetDialog).findByText("Chapters")).toBeVisible();
  },
};

/** A short sheet (appearance, with the phone toolbar at the top): about half the screen. */
export const Short: Story = {
  args: { active: "appearance" },
  decorators: [withAtoms(seed(readerPreferencesAtom, DEFAULT_READER_PREFERENCES), seed(readerOverridesAtom, {}))],
};

/** Closed: nothing over the page, and nothing in the accessibility tree. */
export const Closed: Story = {
  args: { active: null },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole("dialog")).not.toBeInTheDocument();
  },
};
