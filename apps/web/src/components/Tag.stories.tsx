import type { Meta, StoryObj } from "@storybook/react-vite";
import { Tag } from "./Tag";

const meta = {
  title: "Design System/Components/Tag",
  component: Tag,
} satisfies Meta<typeof Tag>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { children: "Fiction" },
};

export const Outline: Story = {
  args: { children: "Non-fiction", variant: "outline" },
};

export const Removable: Story = {
  args: {
    children: "Science",
    onRemove: () => {},
  },
};

export const Group: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Tag>Fiction</Tag>
      <Tag>Philosophy</Tag>
      <Tag>Essays</Tag>
      <Tag variant="outline">New</Tag>
    </div>
  ),
  args: { children: "" },
};
