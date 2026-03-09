import type { Meta, StoryObj } from "@storybook/react-vite";
import { Heading } from "./Heading";

const meta = {
  title: "Design System/Typography/Heading",
  component: Heading,
  argTypes: {
    size: { control: "select", options: ["xl", "2xl", "3xl", "4xl"] },
    as: { control: "select", options: ["h1", "h2", "h3", "h4", "p"] },
  },
} satisfies Meta<typeof Heading>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { children: "Section heading" },
};

export const SizeXl: Story = { args: { size: "xl", children: "Heading xl" } };
export const Size2xl: Story = { args: { size: "2xl", children: "Heading 2xl" } };
export const Size3xl: Story = { args: { size: "3xl", children: "Heading 3xl" } };
export const Size4xl: Story = { args: { size: "4xl", children: "Heading 4xl" } };
