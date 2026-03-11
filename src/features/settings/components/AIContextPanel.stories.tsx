import type { Meta, StoryObj } from "@storybook/react-vite";
import { AIContextPanel } from "./AIContextPanel";

const meta = {
  title: "Features/Settings/AIContextPanel",
  component: AIContextPanel,
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof AIContextPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
