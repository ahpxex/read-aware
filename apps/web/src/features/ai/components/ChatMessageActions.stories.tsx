import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChatMessageError } from "./ChatMessageActions";

// ChatMessageError renders the shared InlineError card with copy resolved
// from the turn's stable errorCode — the raw thrown message never shows.
// These stories double as the error-style reference.
const meta = {
  title: "Interface/AI/ChatMessageError",
  component: ChatMessageError,
  decorators: [
    (Story) => (
      <div className="max-w-md bg-[var(--ra-main-surface-color)] p-4">
        <Story />
      </div>
    ),
  ],
  args: {
    onRetry: () => {},
  },
} satisfies Meta<typeof ChatMessageError>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No code (legacy rows, unclassified throw): the generic localized line, with retry. */
export const UnknownFailure: Story = {};

/** Recognized code (no API key): localized copy plus the open-settings fix. */
export const NotConfigured: Story = {
  args: {
    code: "ai/not-configured",
  },
};

/** Rate limited: transient-failure copy; retry is honest advice here. */
export const RateLimited: Story = {
  args: {
    code: "ai/rate-limited",
  },
};

/** Auth failure: the key is wrong — copy points at Settings, with the fix link. */
export const AuthFailure: Story = {
  args: {
    code: "ai/auth",
  },
};
