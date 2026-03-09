import type { Meta, StoryObj } from "@storybook/react-vite";
import { Breadcrumb } from "./Breadcrumb";

const meta = {
  title: "Design System/Components/Breadcrumb",
  component: Breadcrumb,
} satisfies Meta<typeof Breadcrumb>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    items: [
      { label: "Shelf", onClick: () => {} },
      { label: "Non-Fiction", onClick: () => {} },
      { label: "The White Album" },
    ],
  },
};

export const TwoLevels: Story = {
  args: {
    items: [
      { label: "Settings", onClick: () => {} },
      { label: "Typography" },
    ],
  },
};

export const CustomSeparator: Story = {
  args: {
    items: [
      { label: "Home", onClick: () => {} },
      { label: "Library", onClick: () => {} },
      { label: "Chapter 3" },
    ],
    separator: ">",
  },
};
