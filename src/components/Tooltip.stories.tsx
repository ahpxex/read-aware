import type { Meta, StoryObj } from "@storybook/react-vite";
import { Tooltip } from "./Tooltip";
import { Button } from "./Button";

const meta = {
  title: "Design System/Components/Tooltip",
  component: Tooltip,
  argTypes: {
    side: { control: "select", options: ["top", "bottom", "left", "right"] },
  },
  decorators: [
    (Story) => (
      <div className="flex min-h-32 items-center justify-center">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Top: Story = {
  args: {
    content: "Add to shelf",
    side: "top",
    children: <Button>Hover me</Button>,
  },
};

export const Bottom: Story = {
  args: {
    content: "Remove item",
    side: "bottom",
    children: <Button>Hover me</Button>,
  },
};
