import type { Meta, StoryObj } from "@storybook/react-vite";
import { Kbd } from "./Kbd";

const meta = {
  title: "Design System/Components/Kbd",
  component: Kbd,
} satisfies Meta<typeof Kbd>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SingleKey: Story = {
  args: { children: "K" },
};

export const Combination: Story = {
  render: () => (
    <span className="flex items-center gap-1 text-sm text-stone-500">
      <Kbd>Cmd</Kbd>
      <span>+</span>
      <Kbd>K</Kbd>
    </span>
  ),
  args: { children: "" },
};

export const InContext: Story = {
  render: () => (
    <p className="text-sm text-stone-700">
      Press <Kbd>Esc</Kbd> to close or <Kbd>Cmd</Kbd>+<Kbd>Enter</Kbd> to
      confirm.
    </p>
  ),
  args: { children: "" },
};
