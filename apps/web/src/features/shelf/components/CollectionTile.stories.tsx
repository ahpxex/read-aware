import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CollectionCover } from "../lib/collection-tile-data";
import { CollectionTile } from "./CollectionTile";

/** Flat-color stand-ins for member covers, matching the Shelf stories' helper. */
const cover = (fill: string) =>
  `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='360'%3E%3Crect width='240' height='360' fill='%23${fill}'/%3E%3C/svg%3E`;

const COVERS: CollectionCover[] = ["44403c", "78716c", "292524", "a8a29e"].map((fill, index) => ({
  id: `member-${index}`,
  title: `Member ${index + 1}`,
  author: "Author",
  format: "epub",
  coverUrl: cover(fill),
}));

const meta = {
  title: "Interface/Shelf/CollectionTile",
  component: CollectionTile,
  parameters: { layout: "padded" },
  args: {
    layout: "grid",
    onOpen: () => {},
    data: { id: "c1", name: "Philosophy", count: 12, covers: COVERS },
  },
} satisfies Meta<typeof CollectionTile>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Grid layout: the first three members stacked, the name and count beneath. */
export const Grid: Story = {};

/** Fewer members make a shallower stack, never an empty slot. */
export const GridTwoMembers: Story = {
  args: {
    data: { id: "c2", name: "Currently reading", count: 2, covers: COVERS.slice(0, 2) },
  },
};

/** A single member is one whole cover. */
export const GridOneMember: Story = {
  args: {
    data: { id: "c8", name: "Gifts", count: 1, covers: COVERS.slice(0, 1) },
  },
};

/** A member without a cover keeps its place in the stack with the placeholder. */
export const GridCoverlessMember: Story = {
  args: {
    data: {
      id: "c9",
      name: "Papers",
      count: 3,
      covers: [
        { ...COVERS[0], coverUrl: null, title: "Attention Is All You Need", format: "pdf" },
        ...COVERS.slice(1, 3),
      ],
    },
  },
};

/** An empty collection falls back to a folder glyph. */
export const GridEmpty: Story = {
  args: { data: { id: "c3", name: "To read", count: 0, covers: [] } },
};

/** A long name truncates on one line beneath the stack. */
export const GridLongName: Story = {
  args: {
    data: {
      id: "c4",
      name: "Twentieth-century continental philosophy",
      count: 41,
      covers: COVERS,
    },
  },
};

/** List layout: the same stack as a thumbnail, with a chevron affordance. */
export const List: Story = {
  args: { layout: "list" },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
};

/** List layout with nothing in the collection yet. */
export const ListEmpty: Story = {
  args: { layout: "list", data: { id: "c5", name: "To read", count: 0, covers: [] } },
  decorators: [
    (Story) => (
      <div className="max-w-2xl">
        <Story />
      </div>
    ),
  ],
};

/** In situ: collections sit as peers among books, on the same grid footprint. */
export const AmongBooks: Story = {
  render: (args) => (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-x-6 gap-y-8">
      <CollectionTile {...args} />
      <CollectionTile {...args} data={{ id: "c6", name: "Essays", count: 5, covers: COVERS.slice(0, 3) }} />
      <CollectionTile {...args} data={{ id: "c7", name: "To read", count: 0, covers: [] }} />
    </div>
  ),
};
