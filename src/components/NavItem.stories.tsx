import type { Meta, StoryObj } from "@storybook/react-vite";
import { NavItem } from "./NavItem";

const meta = {
  title: "Design System/Components/NavItem",
  component: NavItem,
} satisfies Meta<typeof NavItem>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { children: "Shelf" },
};

export const Active: Story = {
  args: { active: true, children: "Shelf" },
};

export const Inactive: Story = {
  args: { active: false, children: "Context" },
};
