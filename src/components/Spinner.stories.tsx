import type { Meta, StoryObj } from "@storybook/react-vite";
import { Spinner } from "./Spinner";

const meta = {
  title: "Design System/Components/Spinner",
  component: Spinner,
} satisfies Meta<typeof Spinner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
};

export const Small: Story = {
  args: { size: "sm" },
};

export const Large: Story = {
  args: { size: "lg" },
};

export const CustomColor: Story = {
  args: { className: "text-stone-950" },
};

export const WithLabel: Story = {
  render: (args) => (
    <div className="flex items-center gap-2 text-sm text-stone-500">
      <Spinner {...args} />
      <span>Loading your library...</span>
    </div>
  ),
  args: { size: "sm" },
};
