import type { Meta, StoryObj } from "@storybook/react-vite";
import { Metric } from "./Metric";

const meta = {
  title: "Design System/Components/Metric",
  component: Metric,
} satisfies Meta<typeof Metric>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { label: "Saved words", value: "128", description: "Across 9 books" },
};
