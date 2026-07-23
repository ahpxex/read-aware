import type { Meta, StoryObj } from "@storybook/react-vite";
import { Quote } from "./Quote";

const meta = {
  title: "Design System/Components/Quote",
  component: Quote,
} satisfies Meta<typeof Quote>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: "There is something at work in my soul, which I do not understand.",
    attribution: "Frankenstein",
  },
};
