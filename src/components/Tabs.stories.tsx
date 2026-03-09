import type { Meta, StoryObj } from "@storybook/react-vite";
import { Tabs } from "./Tabs";

const sampleItems = [
  { label: "Overview", content: <p className="text-sm text-stone-700">General information about the item.</p> },
  { label: "Notes", content: <p className="text-sm text-stone-700">Your personal annotations and highlights.</p> },
  { label: "Context", content: <p className="text-sm text-stone-700">AI-generated context and related material.</p> },
];

const meta = {
  title: "Design System/Components/Tabs",
  component: Tabs,
  argTypes: {
    variant: { control: "select", options: ["underline", "pill"] },
  },
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Underline: Story = {
  args: { items: sampleItems, variant: "underline" },
};

export const Pill: Story = {
  args: { items: sampleItems, variant: "pill" },
};

export const DefaultSecondTab: Story = {
  args: { items: sampleItems, defaultIndex: 1 },
};
