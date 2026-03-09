import type { Meta, StoryObj } from "@storybook/react-vite";
import { IconButton } from "./IconButton";

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

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
  args: { icon: <CloseIcon />, label: "Close" },
};

export const Small: Story = {
  args: { icon: <CloseIcon />, label: "Close", size: "sm" },
};
