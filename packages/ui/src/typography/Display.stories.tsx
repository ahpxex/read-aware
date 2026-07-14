import type { Meta, StoryObj } from "@storybook/react-vite";
import { Display } from "./Display";

const meta = {
  title: "Design System/Components/Typography/Display",
  component: Display,
  argTypes: {
    size: { control: "select", options: ["5xl", "6xl", "7xl"] },
    as: { control: "select", options: ["h1", "h2", "h3", "p", "span"] },
  },
} satisfies Meta<typeof Display>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { children: "A shelf that reads with the restraint of a printed page." },
};

export const Size5xl: Story = {
  args: { size: "5xl", children: "Display at 5xl" },
};

export const Size6xl: Story = {
  args: { size: "6xl", children: "Display at 6xl" },
};

export const Size7xl: Story = {
  args: { size: "7xl", children: "Display at 7xl" },
};
