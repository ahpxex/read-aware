import type { Meta, StoryObj } from "@storybook/react-vite";
import { Eyebrow } from "./Eyebrow";

const meta = {
  title: "Design System/Components/Typography/Eyebrow",
  component: Eyebrow,
  argTypes: {
    as: { control: "select", options: ["p", "span", "dt", "label"] },
  },
} satisfies Meta<typeof Eyebrow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { children: "Shelf" },
};

export const AsLabel: Story = {
  args: { as: "span", children: "Context" },
};
