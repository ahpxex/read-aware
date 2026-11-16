import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { BookmarkRow } from "./ReaderBookmarkList";
import NotesStories from "./ReaderNotesList.stories";

/** The notes list's bookmark fixture. */
const [bookmark] = NotesStories.args.bookmarks.bookmarks;
const actions = (name: string) => `Actions for “${name}”`;

/**
 * One bookmark in the notes list: a bookmark glyph where an annotation has its
 * color rule, the name, then the date. Its actions (rename in place, delete)
 * sit in a menu at the end of the date line, shown on hover or focus — and
 * always on touch. Rendered at the side panel's width.
 */
const meta = {
  title: "Interface/Reader/ReaderBookmarkList",
  component: BookmarkRow,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="w-72 bg-[var(--ra-main-surface-color)] px-2 py-3">
        <Story />
      </div>
    ),
  ],
  args: { bookmark, onOpen: fn(), onRename: fn(), onRemove: fn() },
} satisfies Meta<typeof BookmarkRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** At rest; a click opens the bookmarked place. */
export const Default: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(await within(canvasElement).findByRole("button", { name: /^Canto Two/ }));
    await expect(args.onOpen).toHaveBeenCalledWith(bookmark);
  },
};

/** A long name wraps to two lines, then truncates. */
export const LongName: Story = {
  args: {
    bookmark: {
      ...bookmark,
      name: "Kinbote's note to line 172, where the commentary finally admits it is about Zembla rather than the poem",
    },
  },
};

/** The row's menu, opened: rename and delete. */
export const ActionsMenu: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: actions(bookmark.name) }));
    const rename = await canvas.findByRole("menuitem", { name: "Rename" });
    // Visible once the menu has popped in.
    await waitFor(() => expect(rename).toBeVisible());
    await expect(canvas.getByRole("menuitem", { name: "Delete" })).toBeVisible();
  },
};

/**
 * Renaming in place: the name becomes a field, focused, holding the new name
 * as typed. Enter (or leaving the field) keeps it; Escape restores the old one.
 */
export const Renaming: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: actions(bookmark.name) }));
    await userEvent.click(await canvas.findByRole("menuitem", { name: "Rename" }));
    const field = await canvas.findByRole("textbox", { name: "Bookmark name" });
    await expect(field).toHaveFocus();
    await expect(field).toHaveValue(bookmark.name);
    await userEvent.clear(field);
    await userEvent.type(field, "The waxwing");
  },
};

/** Delete, from the menu. */
export const Deleting: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: actions(bookmark.name) }));
    await userEvent.click(await canvas.findByRole("menuitem", { name: "Delete" }));
    await expect(args.onRemove).toHaveBeenCalledWith(bookmark);
  },
};
