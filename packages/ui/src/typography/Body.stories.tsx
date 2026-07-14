import type { Meta, StoryObj } from "@storybook/react-vite";
import { Body } from "./Body";

const meta = {
  title: "Design System/Components/Typography/Body",
  component: Body,
  argTypes: {
    size: { control: "select", options: ["base", "lg"] },
    as: { control: "select", options: ["p", "span", "div"] },
  },
} satisfies Meta<typeof Body>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children:
      "The layout stays quiet so the collection can breathe. Titles, sequence, and open margins do the work without decorative chrome competing for attention.",
  },
};

export const Large: Story = {
  args: {
    size: "lg",
    children:
      "Supporting material sits in a calm, editorial frame. The emphasis stays on comprehension.",
  },
};
