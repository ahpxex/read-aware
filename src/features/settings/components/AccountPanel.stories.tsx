import type { Meta, StoryObj } from "@storybook/react-vite";
import { AccountPanel } from "./AccountPanel";

const meta = {
  title: "Features/Settings/AccountPanel",
  component: AccountPanel,
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof AccountPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
