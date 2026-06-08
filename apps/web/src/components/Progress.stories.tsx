import type { Meta, StoryObj } from "@storybook/react-vite";
import { Progress } from "./Progress";

const meta = {
  title: "Design System/Components/Progress",
  component: Progress,
  argTypes: {
    size: { control: "select", options: ["sm", "md", "lg"] },
    value: { control: { type: "range", min: 0, max: 100 } },
    showValue: { control: "boolean" },
  },
} satisfies Meta<typeof Progress>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { value: 40 },
};

export const WithLabel: Story = {
  args: { value: 3, max: 12, label: "Reading progress", showValue: true },
};

export const Small: Story = {
  args: { value: 70, size: "sm" },
};

export const Large: Story = {
  args: { value: 85, size: "lg", showValue: true },
};

export const Complete: Story = {
  args: { value: 100, label: "Complete", showValue: true },
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Progress value={60} size="sm" />
      <Progress value={60} size="md" />
      <Progress value={60} size="lg" />
    </div>
  ),
  args: { value: 0 },
};
