import type { Meta, StoryObj } from "@storybook/react-vite";
import { EmptyState } from "./EmptyState";
import { Button } from "./Button";

const BookIcon = () => (
  <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M8 6h12a4 4 0 014 4v28a3 3 0 00-3-3H8V6z" />
    <path d="M40 6H28a4 4 0 00-4 4v28a3 3 0 013-3h13V6z" />
  </svg>
);

const meta = {
  title: "Design System/Components/EmptyState",
  component: EmptyState,
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: "No items on your shelf",
    description: "Start by adding something to read.",
  },
};

export const WithIcon: Story = {
  args: {
    icon: <BookIcon />,
    title: "Your shelf is empty",
    description: "Add your first book to get started with ReadAware.",
  },
};

export const WithAction: Story = {
  args: {
    icon: <BookIcon />,
    title: "Nothing here yet",
    description: "Your reading list will appear here once you add items.",
    action: <Button size="sm">Browse library</Button>,
  },
};

export const Minimal: Story = {
  args: {
    title: "No results found",
  },
};
