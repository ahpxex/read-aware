import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChatMessageError } from "./ChatMessageActions";

// ChatMessageError is the app's canonical quiet error card — stone palette,
// icon + title carry the semantics, no red tint. These stories double as the
// error-style reference.
const meta = {
  title: "Interface/AI/ChatMessageError",
  component: ChatMessageError,
  decorators: [
    (Story) => (
      <div className="max-w-md bg-paper p-4">
        <Story />
      </div>
    ),
  ],
  args: {
    message: "network error: connection reset",
    onRetry: () => {},
  },
} satisfies Meta<typeof ChatMessageError>;

export default meta;
type Story = StoryObj<typeof meta>;

/** An unrecognized failure: the raw thrown detail is the only clue, so it shows verbatim, with retry. */
export const UnknownFailure: Story = {};

/** Recognized code (no API key): localized copy plus the open-settings fix replace the raw message. */
export const NotConfigured: Story = {
  args: {
    message: "AI is not configured — add an API key in Settings → AI.",
    code: "ai-not-configured",
  },
};

/** A long multi-line detail clamps to three lines (full text on hover) — a stack trace can't swallow the panel. */
export const LongDetail: Story = {
  args: {
    message: [
      "400 invalid_request_error: max_tokens must be less than or equal to the model's output limit (8192) for this request",
      "    at PiClient.request (pi-client.ts:212:15)",
      "    at async PiChatTransport.send (pi-chat-transport.ts:88:9)",
      "    at async runTurn (useBookConversation.ts:141:5)",
      "    at async handleSend (ChatPanel.tsx:64:3)",
    ].join("\n"),
  },
};
