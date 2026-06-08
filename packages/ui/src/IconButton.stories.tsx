import type { Meta, StoryObj } from "@storybook/react-vite";
import { X } from "@phosphor-icons/react";
import { IconButton } from "./IconButton";

const meta = {
  title: "Design System/Components/IconButton",
  component: IconButton,
  argTypes: {
    size: { control: "select", options: ["sm", "md"] },
  },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { icon: <X size={16} weight="regular" />, label: "Close" },
};

export const Small: Story = {
  args: { icon: <X size={16} weight="regular" />, label: "Close", size: "sm" },
};
