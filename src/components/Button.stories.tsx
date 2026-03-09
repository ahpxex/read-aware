import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button";

const meta = {
  title: "Design System/Components/Button",
  component: Button,
  argTypes: {
    variant: { control: "select", options: ["default", "ghost"] },
    size: { control: "select", options: ["sm", "md"] },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { children: "Read more" },
};

export const Ghost: Story = {
  args: { variant: "ghost", children: "Cancel" },
};

export const Small: Story = {
  args: { size: "sm", children: "Details" },
};
