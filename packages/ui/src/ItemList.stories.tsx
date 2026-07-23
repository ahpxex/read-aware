import { BookBookmark } from "@phosphor-icons/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ItemList } from "./ItemList";
import { Tag } from "./Tag";

const meta = {
  title: "Design System/Components/ItemList",
  component: ItemList,
} satisfies Meta<typeof ItemList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: (
      <>
        <ItemList.Item
          icon={<BookBookmark size={16} />}
          title="serendipity"
          subtitle="a happy accident"
          accessories={<Tag>Frankenstein</Tag>}
          onClick={() => undefined}
        />
        <ItemList.Item
          icon={<BookBookmark size={16} />}
          title="ineffable"
          subtitle="too great to be expressed in words"
          accessories={<Tag>The Waves</Tag>}
          onClick={() => undefined}
        />
      </>
    ),
  },
};
