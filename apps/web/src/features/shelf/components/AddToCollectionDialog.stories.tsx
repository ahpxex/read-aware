import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import type { Collection } from "../../library/lib/library-types";
import { AddToCollectionDialog } from "./AddToCollectionDialog";

const collections: Collection[] = [
  { id: "c1", name: "Philosophy", createdAt: "2026-01-14T10:00:00.000Z" },
  { id: "c2", name: "To read", createdAt: "2026-02-03T10:00:00.000Z" },
  { id: "c3", name: "Essays", createdAt: "2026-03-21T10:00:00.000Z" },
];

const meta = {
  title: "Interface/Shelf/AddToCollectionDialog",
  component: AddToCollectionDialog,
  parameters: { layout: "fullscreen" },
  args: {
    open: true,
    count: 3,
    collections,
    onClose: () => {},
    onAssign: () => {},
    onCreate: async (name) => ({
      id: `new-${name}`,
      name,
      createdAt: "2026-06-28T10:00:00.000Z",
    }),
  },
} satisfies Meta<typeof AddToCollectionDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Create-new field on top, existing collections below, ungroup at the foot. */
export const Default: Story = {};

/** One book selected — the title is pluralized off the count. */
export const SingleBook: Story = {
  args: { count: 1 },
};

/** No collections exist yet: only the create field and the ungroup action. */
export const NoCollections: Story = {
  args: { collections: [] },
};

/** A long list scrolls inside the dialog rather than growing it past the viewport. */
export const ManyCollections: Story = {
  args: {
    collections: Array.from({ length: 24 }, (_, i) => ({
      id: `c${i}`,
      name: `Collection ${i + 1}`,
      createdAt: "2026-01-01T00:00:00.000Z",
    })),
  },
};

/** Create stays disabled until the name has non-whitespace content. */
export const CreateDisabledWhileEmpty: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    await userEvent.type(canvas.getByLabelText("New collection"), "   ");
  },
};

/** With a name typed, the create action becomes available. */
export const NamingANewCollection: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement.ownerDocument.body);
    await userEvent.type(canvas.getByLabelText("New collection"), "Reread in 2027");
  },
};
