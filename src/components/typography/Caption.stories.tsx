import type { Meta, StoryObj } from "@storybook/react-vite";
import { Caption } from "./Caption";

const meta = {
  title: "Design System/Typography/Caption",
  component: Caption,
  argTypes: {
    as: { control: "select", options: ["span", "p", "small"] },
  },
} satisfies Meta<typeof Caption>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { children: "Last updated 3 minutes ago" },
};

export const AsSmall: Story = {
  args: { as: "small", children: "12 items in collection" },
};
