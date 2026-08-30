import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button";
import { InlineError } from "./InlineError";

const meta = {
  title: "Design System/Components/InlineError",
  component: InlineError,
} satisfies Meta<typeof InlineError>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: "Reply failed",
    children: "Couldn't reach the AI provider. Check your connection and try again.",
    onRetry: () => {},
    retryLabel: "Retry",
  },
};

export const BodyOnly: Story = {
  args: {
    children: "The local database ran into a problem.",
  },
};

export const WithFixAction: Story = {
  args: {
    title: "Reply failed",
    children: "AI isn't set up yet — add an API key to start chatting.",
    action: (
      <Button
        variant="link"
        className="h-auto p-0 align-baseline text-xs underline underline-offset-2"
      >
        Open settings
      </Button>
    ),
  },
};

export const Compact: Story = {
  args: {
    compact: true,
    children: "Activation failed. Details are in the app log.",
    onRetry: () => {},
    retryLabel: "Retry",
  },
};
