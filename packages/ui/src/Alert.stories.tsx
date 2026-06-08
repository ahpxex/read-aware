import type { Meta, StoryObj } from "@storybook/react-vite";
import { Alert } from "./Alert";
import { Button } from "./Button";

const meta = {
  title: "Design System/Components/Alert",
  component: Alert,
} satisfies Meta<typeof Alert>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: "Note",
    children: "Your reading session has been saved.",
  },
};

export const Destructive: Story = {
  args: {
    variant: "destructive",
    title: "Error",
    children: "Failed to sync your library. Check your connection and try again.",
  },
};

export const Success: Story = {
  args: {
    variant: "success",
    title: "Done",
    children: "Book added to your shelf.",
  },
};

export const WithAction: Story = {
  args: {
    variant: "destructive",
    title: "Sync failed",
    children: "Your changes could not be saved.",
    action: <Button variant="link" size="sm">Retry</Button>,
  },
};

export const NoTitle: Story = {
  args: {
    children: "This is a simple inline message without a title.",
  },
};
