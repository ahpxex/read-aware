import type { Meta, StoryObj } from "@storybook/react-vite";
import { DisplayPanel } from "./DisplayPanel";

const meta = {
  title: "Features/Settings/DisplayPanel",
  component: DisplayPanel,
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof DisplayPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
