import type { Meta, StoryObj } from "@storybook/react-vite";
import { ProgressRing } from "./ProgressRing";

const meta: Meta<typeof ProgressRing> = {
  title: "Design System/Components/ProgressRing",
  component: ProgressRing,
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj<typeof ProgressRing>;

export const Determinate: Story = {
  args: { value: 0.63, size: 32 },
};

export const Indeterminate: Story = {
  args: { value: null, size: 32 },
};

export const InlineSizes: Story = {
  render: () => (
    <div className="flex items-center gap-4 text-stone-600">
      <ProgressRing value={0.25} size={14} />
      <ProgressRing value={0.5} size={16} />
      <ProgressRing value={0.75} size={24} />
      <ProgressRing value={null} size={16} />
    </div>
  ),
};
