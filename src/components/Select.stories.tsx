import type { Meta, StoryObj } from "@storybook/react-vite";
import { Select } from "./Select";

const meta = {
  title: "Design System/Components/Select",
  component: Select,
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: "Sort by",
    options: [
      { label: "Date added", value: "date" },
      { label: "Title", value: "title" },
      { label: "Author", value: "author" },
    ],
  },
};
