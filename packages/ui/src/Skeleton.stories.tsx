import type { Meta, StoryObj } from "@storybook/react-vite";
import { Skeleton } from "./Skeleton";

const meta = {
  title: "Design System/Components/Skeleton",
  component: Skeleton,
  argTypes: {
    variant: { control: "select", options: ["text", "avatar", "rectangular"] },
    lines: { control: { type: "number", min: 1, max: 10 } },
  },
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TextSingle: Story = {
  args: { variant: "text", width: "200px" },
};

export const TextMultiline: Story = {
  args: { variant: "text", lines: 4 },
};

export const Avatar: Story = {
  args: { variant: "avatar", width: "40px", height: "40px" },
};

export const Rectangular: Story = {
  args: { variant: "rectangular", width: "100%", height: "120px" },
};

export const CardSkeleton: Story = {
  render: () => (
    <div className="flex max-w-sm flex-col gap-4 rounded-surface border border-border p-6">
      <div className="flex items-center gap-3">
        <Skeleton variant="avatar" width="32px" height="32px" />
        <Skeleton variant="text" width="120px" />
      </div>
      <Skeleton variant="text" lines={3} />
      <Skeleton variant="rectangular" width="100%" height="24px" />
    </div>
  ),
  args: {},
};
