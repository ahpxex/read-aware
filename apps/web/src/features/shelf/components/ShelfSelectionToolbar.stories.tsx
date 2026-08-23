import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import type { Collection } from "../../library/lib/library-types";
import { ShelfSelectionToolbar } from "./ShelfSelectionToolbar";

const collections: Collection[] = [
  { id: "c1", name: "Philosophy", createdAt: "2026-01-14T10:00:00.000Z" },
  { id: "c2", name: "To read", createdAt: "2026-02-03T10:00:00.000Z" },
];

/**
 * The batch bar portals itself to `document.body` and pins to the bottom of the
 * viewport, so these stories render fullscreen — in a padded canvas it would
 * float over the padding and read as misplaced.
 */
const meta = {
  title: "Interface/Shelf/ShelfSelectionToolbar",
  component: ShelfSelectionToolbar,
  parameters: { layout: "fullscreen" },
  args: {
    count: 3,
    total: 12,
    collections,
    onSelectAll: () => {},
    onClear: () => {},
    onAssignCollection: () => {},
    onCreateCollection: async (name) => ({
      id: `new-${name}`,
      name,
      createdAt: "2026-06-28T10:00:00.000Z",
    }),
    onRemove: () => {},
    onDone: () => {},
  },
} satisfies Meta<typeof ShelfSelectionToolbar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A partial selection: the toggle offers "select all". */
export const PartialSelection: Story = {};

/** Everything selected — the same control flips to "clear". */
export const AllSelected: Story = {
  args: { count: 12, total: 12 },
};

/** Selection mode entered with nothing picked: the batch actions are disabled. */
export const NothingSelected: Story = {
  args: { count: 0 },
};

/** One book, to check the count line's singular form. */
export const SingleSelection: Story = {
  args: { count: 1 },
};

/** The bulk remove confirmation, which states the count before destroying. */
export const RemoveConfirmation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole("button", { name: "Remove selected" }));
  },
};

/** The collection picker, reached from the folder action. */
export const AddToCollection: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    await userEvent.click(
      canvas.getByRole("button", { name: "Add selected to collection" }),
    );
  },
};
