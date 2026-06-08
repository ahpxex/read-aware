import type { Meta, StoryObj } from "@storybook/react-vite";
import { TextArea } from "./TextArea";

const meta = {
  title: "Design System/Components/TextArea",
  component: TextArea,
} satisfies Meta<typeof TextArea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { label: "Notes", placeholder: "Add your notes here" },
};

export const WithValue: Story = {
  args: {
    label: "Summary",
    defaultValue:
      "The layout stays quiet so the collection can breathe. Titles, sequence, and open margins do the work.",
  },
};

export const WithHelperText: Story = {
  args: {
    label: "Review",
    placeholder: "Write your review...",
    helperText: "Markdown is supported",
  },
};

export const WithError: Story = {
  args: {
    label: "Notes",
    defaultValue: "",
    error: "This field is required",
  },
};

export const Outlined: Story = {
  args: {
    label: "Description",
    placeholder: "Enter a description...",
    variant: "outlined",
  },
};

export const OutlinedWithError: Story = {
  args: {
    label: "Description",
    placeholder: "Enter a description...",
    variant: "outlined",
    error: "Description must be at least 20 characters",
  },
};
