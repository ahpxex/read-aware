import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReadingPanel } from "./ReadingPanel";

const meta = {
  title: "Features/Settings/ReadingPanel",
  component: ReadingPanel,
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof ReadingPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
