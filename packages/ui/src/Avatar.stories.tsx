import type { Meta, StoryObj } from "@storybook/react-vite";
import { Avatar } from "./Avatar";

const meta = {
  title: "Design System/Components/Avatar",
  component: Avatar,
  argTypes: {
    size: { control: "select", options: ["xs", "sm", "md", "lg", "xl"] },
  },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithInitials: Story = {
  args: { alt: "Joan Didion", size: "md" },
};

export const WithCustomInitials: Story = {
  args: { initials: "RA", size: "md" },
};

export const WithImage: Story = {
  args: {
    src: "https://api.dicebear.com/9.x/initials/svg?seed=JD&backgroundColor=d6d3d1&textColor=44403c",
    alt: "Joan Didion",
    size: "md",
  },
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Avatar alt="Joan Didion" size="xs" />
      <Avatar alt="Joan Didion" size="sm" />
      <Avatar alt="Joan Didion" size="md" />
      <Avatar alt="Joan Didion" size="lg" />
      <Avatar alt="Joan Didion" size="xl" />
    </div>
  ),
  args: {},
};

export const Group: Story = {
  render: () => (
    <div className="flex -space-x-2">
      <Avatar initials="JD" size="sm" className="ring-2 ring-paper" />
      <Avatar initials="AB" size="sm" className="ring-2 ring-paper" />
      <Avatar initials="MK" size="sm" className="ring-2 ring-paper" />
    </div>
  ),
  args: {},
};
