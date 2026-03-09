import type { Meta, StoryObj } from "@storybook/react-vite";
import { TextField } from "./TextField";

const meta = {
  title: "Design System/Components/TextField",
  component: TextField,
} satisfies Meta<typeof TextField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { label: "Title", placeholder: "Enter a title" },
};

export const WithValue: Story = {
  args: { label: "Author", defaultValue: "Joan Didion" },
};
