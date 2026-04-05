import type { Meta, StoryObj } from "@storybook/react-vite";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { TextField } from "./TextField";

const meta = {
  title: "Design System/Components/TextField",
  component: TextField,
  argTypes: {
    variant: { control: "select", options: ["underline", "outlined"] },
  },
} satisfies Meta<typeof TextField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { label: "Title", placeholder: "Enter a title" },
};

export const WithValue: Story = {
  args: { label: "Author", defaultValue: "Joan Didion" },
};

export const WithHelperText: Story = {
  args: {
    label: "Email",
    placeholder: "you@example.com",
    type: "email",
    helperText: "We will never share your email.",
  },
};

export const WithError: Story = {
  args: {
    label: "Username",
    defaultValue: "ab",
    error: "Username must be at least 3 characters.",
  },
};

export const WithLeadingIcon: Story = {
  args: {
    label: "Search",
    placeholder: "Search your shelf",
    leadingIcon: <MagnifyingGlass size={16} weight="regular" />,
  },
};

export const Outlined: Story = {
  args: {
    label: "Title",
    placeholder: "Enter a title",
    variant: "outlined",
  },
};

export const OutlinedWithError: Story = {
  args: {
    label: "Password",
    type: "password",
    variant: "outlined",
    error: "Password is required.",
  },
};

export const Disabled: Story = {
  args: {
    label: "Locked field",
    defaultValue: "Cannot edit",
    disabled: true,
  },
};
