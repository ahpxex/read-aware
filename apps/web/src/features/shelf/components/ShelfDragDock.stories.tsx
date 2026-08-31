import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Collection } from "../../library/lib/library-types";
import { ShelfDragDock } from "./ShelfDragDock";

const collections: Collection[] = [
  { id: "c1", name: "Philosophy", createdAt: "2026-01-14T10:00:00.000Z" },
  { id: "c2", name: "To read", createdAt: "2026-02-03T10:00:00.000Z" },
];

/**
 * The dock portals itself to `document.body` and pins to the bottom of the
 * viewport (it appears only while a book drag is in flight, where the
 * selection toolbar otherwise sits), so these stories render fullscreen. The
 * highlight states need a live HTML5 drag and can't be shown statically.
 */
const meta = {
  title: "Interface/Shelf/ShelfDragDock",
  component: ShelfDragDock,
  parameters: { layout: "fullscreen" },
  args: {
    collections,
    inCollection: false,
    onAssign: () => {},
    onNewCollection: () => {},
    onDelete: () => {},
  },
} satisfies Meta<typeof ShelfDragDock>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Top-level shelf: existing collections, new collection, and remove. */
export const TopLevel: Story = {};

/** Inside a collection: "remove from collection" joins, the open one drops out. */
export const InsideCollection: Story = {
  args: {
    collections: collections.slice(1),
    inCollection: true,
  },
};

/** No collections yet — the dock still offers creating one and removing. */
export const NoCollections: Story = {
  args: { collections: [] },
};
