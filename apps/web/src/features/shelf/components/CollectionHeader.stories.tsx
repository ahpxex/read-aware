import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import type { Collection } from "../../library/lib/library-types";
import { CollectionHeader } from "./CollectionHeader";

const collection: Collection = {
  id: "c1",
  name: "Philosophy",
  createdAt: "2026-01-14T10:00:00.000Z",
};

const meta = {
  title: "Interface/Shelf/CollectionHeader",
  component: CollectionHeader,
  parameters: { layout: "padded" },
  args: {
    collection,
    count: 12,
    onRename: () => {},
    onDelete: () => {},
  },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-3xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CollectionHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Resting state: name, count, and the rename/delete actions. */
export const Default: Story = {};

/** A single book — the count line is pluralized, not hard-coded. */
export const SingleBook: Story = {
  args: { count: 1 },
};

/** An emptied collection still shows its header, so it can be renamed or deleted. */
export const EmptyCollection: Story = {
  args: { count: 0 },
};

/** Long names truncate; the actions keep their place at the end of the row. */
export const LongName: Story = {
  args: {
    collection: { ...collection, name: "Twentieth-century continental philosophy and its critics" },
    count: 41,
  },
};

/** Renaming: the heading swaps for an inline field seeded with the current name. */
export const Renaming: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Rename collection" }));
  },
};

/** The delete confirmation, which names the collection before destroying it. */
export const DeleteConfirmation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Delete collection" }));
  },
};
