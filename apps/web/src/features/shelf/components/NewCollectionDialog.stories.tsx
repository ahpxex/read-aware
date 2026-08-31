import type { Meta, StoryObj } from "@storybook/react-vite";
import { NewCollectionDialog } from "./NewCollectionDialog";

/** Names the collection a "new collection" drag-drop promised. */
const meta = {
  title: "Interface/Shelf/NewCollectionDialog",
  component: NewCollectionDialog,
  args: {
    open: true,
    count: 3,
    onClose: () => {},
    onCreate: async () => true,
  },
} satisfies Meta<typeof NewCollectionDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Several dragged books awaiting their collection. */
export const SeveralBooks: Story = {};

/** A single dragged book, to check the title's singular form. */
export const SingleBook: Story = {
  args: { count: 1 },
};
