import type { Meta, StoryObj } from "@storybook/react-vite";
import { CollectionTile } from "./CollectionTile";

/** Flat-color stand-ins for member covers, matching the Shelf stories' helper. */
const cover = (fill: string) =>
  `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='360'%3E%3Crect width='240' height='360' fill='%23${fill}'/%3E%3C/svg%3E`;

const COVERS = [cover("44403c"), cover("78716c"), cover("292524"), cover("a8a29e")];

const meta = {
  title: "Interface/Shelf/CollectionTile",
  component: CollectionTile,
  parameters: { layout: "padded" },
  args: {
    layout: "grid",
    onOpen: () => {},
    data: { id: "c1", name: "Philosophy", count: 12, coverUrls: COVERS },
  },
} satisfies Meta<typeof CollectionTile>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Grid layout: the 2×2 montage with the name and count banded across the foot. */
export const Grid: Story = {};

/** Fewer than four members — the montage pads with blanks, never restretches. */
export const GridPartialMontage: Story = {
  args: {
    data: { id: "c2", name: "Currently reading", count: 2, coverUrls: COVERS.slice(0, 2) },
  },
};

/** An empty collection falls back to a folder glyph. */
export const GridEmpty: Story = {
  args: { data: { id: "c3", name: "To read", count: 0, coverUrls: [] } },
};

/** A long name truncates inside the band rather than wrapping over the covers. */
export const GridLongName: Story = {
  args: {
    data: {
      id: "c4",
      name: "Twentieth-century continental philosophy",
      count: 41,
      coverUrls: COVERS,
    },
  },
};

/** List layout: the same montage as a thumbnail, with a chevron affordance. */
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
  args: { layout: "list", data: { id: "c5", name: "To read", count: 0, coverUrls: [] } },
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
      <CollectionTile
        {...args}
        data={{ id: "c6", name: "Essays", count: 5, coverUrls: COVERS.slice(0, 3) }}
      />
      <CollectionTile {...args} data={{ id: "c7", name: "To read", count: 0, coverUrls: [] }} />
    </div>
  ),
};
