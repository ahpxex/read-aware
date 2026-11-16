import type { Meta, StoryObj } from "@storybook/react-vite";
import { BookRemoveDialog, BooksRemoveDialog } from "./BookDialogs";
import { book } from "./book-dialogs.fixtures";

/** The library's remove confirmations. Book details have their own stories (BookDetailsDialog). */
const meta = {
  title: "Interface/Shelf/BookDialogs",
  component: BookRemoveDialog,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof BookRemoveDialog>;

export default meta;
type RemoveStory = StoryObj<typeof BookRemoveDialog>;
type BulkRemoveStory = StoryObj<typeof BooksRemoveDialog>;

/** Single-book removal, which names the book and warns about the stored file. */
export const RemoveOne: RemoveStory = {
  render: (args) => <BookRemoveDialog {...args} />,
  args: { book, open: true, onClose: () => {}, onConfirm: () => {} },
};

/** Bulk removal from the selection toolbar. */
export const RemoveMany: BulkRemoveStory = {
  render: (args) => <BooksRemoveDialog {...args} />,
  args: { count: 7, open: true, onClose: () => {}, onConfirm: () => {} },
};

/** The bulk dialog's singular form, which reads differently from the plural. */
export const RemoveManySingular: BulkRemoveStory = {
  render: (args) => <BooksRemoveDialog {...args} />,
  args: { count: 1, open: true, onClose: () => {}, onConfirm: () => {} },
};
