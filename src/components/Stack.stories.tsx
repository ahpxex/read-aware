import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "./Stack";

const meta = {
  title: "Design System/Components/Stack",
  component: Stack,
  argTypes: {
    direction: { control: "select", options: ["vertical", "horizontal"] },
    gap: { control: "select", options: ["sm", "md", "lg", "xl"] },
  },
} satisfies Meta<typeof Stack>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Vertical: Story = {
  args: {
    direction: "vertical",
    gap: "md",
    children: (
      <>
        <div className="h-8 rounded bg-stone-200" />
        <div className="h-8 rounded bg-stone-200" />
        <div className="h-8 rounded bg-stone-200" />
      </>
    ),
  },
};

export const Horizontal: Story = {
  args: {
    direction: "horizontal",
    gap: "lg",
    children: (
      <>
        <div className="h-8 w-20 rounded bg-stone-200" />
        <div className="h-8 w-20 rounded bg-stone-200" />
        <div className="h-8 w-20 rounded bg-stone-200" />
      </>
    ),
  },
};
