import { BookBookmark, Trash } from "@phosphor-icons/react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconButton } from "./IconButton";
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

/**
 * Rows with their own controls: `actions` render beside the row's button, not
 * inside it, so the remove button is a separate tab stop and valid HTML.
 * Passive `accessories` (the tag) still sit inside the row.
 */
export const WithActions: Story = {
  args: {
    children: (
      <>
        <ItemList.Item
          icon={<BookBookmark size={16} />}
          title="serendipity"
          subtitle="the occurrence of events by chance in a happy way"
          accessories={<Tag>Frankenstein</Tag>}
          actions={<IconButton size="sm" icon={<Trash size={15} />} label="Remove serendipity" onClick={() => {}} />}
          onClick={() => {}}
          disclosure="none"
          selected
        />
        <ItemList.Item
          icon={<BookBookmark size={16} />}
          title="ephemeral"
          subtitle="lasting for a very short time"
          actions={<IconButton size="sm" icon={<Trash size={15} />} label="Remove ephemeral" onClick={() => {}} />}
          onClick={() => {}}
          disclosure="none"
        />
      </>
    ),
  },
};
