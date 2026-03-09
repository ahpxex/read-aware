import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "./Badge";

const meta = {
  title: "Design System/Components/Badge",
  component: Badge,
  argTypes: {
    variant: { control: "select", options: ["default", "outline", "muted"] },
  },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { children: "New" },
};

export const Outline: Story = {
  args: { variant: "outline", children: "Draft" },
};

export const Muted: Story = {
  args: { variant: "muted", children: "Archived" },
};

export const AllVariants: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Badge>New</Badge>
      <Badge variant="outline">Draft</Badge>
      <Badge variant="muted">Archived</Badge>
    </div>
  ),
  args: { children: "" },
};
