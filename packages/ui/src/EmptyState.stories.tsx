import type { Meta, StoryObj } from "@storybook/react-vite";
import { BookOpen } from "@phosphor-icons/react";
import { EmptyState } from "./EmptyState";
import { Button } from "./Button";

const BookIcon = () => <BookOpen size={48} weight="thin" aria-hidden="true" />;

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
