import type { Meta, StoryObj } from "@storybook/react-vite";
import { Select } from "./Select";

const sampleOptions = [
  { label: "Date added", value: "date" },
  { label: "Title", value: "title" },
  { label: "Author", value: "author" },
  { label: "Rating", value: "rating" },
];

const meta = {
  title: "Design System/Components/Select",
  component: Select,
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: "Sort by",
    options: sampleOptions,
  },
};

export const WithPlaceholder: Story = {
  args: {
    label: "Category",
    options: sampleOptions,
    placeholder: "Choose a category...",
    defaultValue: "",
  },
};

export const WithHelperText: Story = {
  args: {
    label: "Sort by",
    options: sampleOptions,
    helperText: "Controls the order of your reading list",
  },
};

export const WithError: Story = {
  args: {
    label: "Genre",
    options: sampleOptions,
    placeholder: "Select a genre...",
    defaultValue: "",
    error: "Please select a genre",
  },
};

export const Outlined: Story = {
  args: {
    label: "Sort by",
    options: sampleOptions,
    variant: "outlined",
  },
};

export const OutlinedWithError: Story = {
  args: {
    label: "Genre",
    options: sampleOptions,
    placeholder: "Select a genre...",
    defaultValue: "",
    variant: "outlined",
    error: "Please select a genre",
  },
};
