import type { Meta, StoryObj } from "@storybook/react-vite";
import { Accordion } from "./Accordion";

const faqItems = [
  {
    label: "What is ReadAware?",
    content:
      "ReadAware is an AI-native reading application designed for context-rich reading and AI-assisted understanding.",
  },
  {
    label: "How does the shelf work?",
    content:
      "The shelf is your personal reading collection. Add items to it and they stay organized with minimal visual chrome.",
  },
  {
    label: "Can I customize the reading experience?",
    content:
      "Settings are presented as quiet editorial controls. You can adjust typography, spacing, and context display preferences.",
  },
];

const meta = {
  title: "Design System/Components/Accordion",
  component: Accordion,
  argTypes: {
    type: { control: "select", options: ["single", "multiple"] },
  },
} satisfies Meta<typeof Accordion>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Single: Story = {
  args: { items: faqItems, type: "single" },
};

export const Multiple: Story = {
  args: { items: faqItems, type: "multiple" },
};

export const DefaultOpen: Story = {
  args: { items: faqItems, type: "single", defaultOpen: [0] },
};

export const AllOpen: Story = {
  args: { items: faqItems, type: "multiple", defaultOpen: [0, 1, 2] },
};
