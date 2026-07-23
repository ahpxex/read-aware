import type { Meta, StoryObj } from "@storybook/react-vite";
import { Section } from "./Section";
import { Body } from "./typography/Body";

const meta = {
  title: "Design System/Components/Section",
  component: Section,
} satisfies Meta<typeof Section>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: "Source",
    description: "Where this note entered your reading trace.",
    children: <Body className="text-sm">Frankenstein, chapter 4</Body>,
  },
};
