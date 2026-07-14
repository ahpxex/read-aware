import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ChatSelectionAttachment } from "../lib/chat-types";
import { ChatComposer } from "./ChatComposer";

const PASSAGE: ChatSelectionAttachment = {
  kind: "selection",
  text: "Every action you take is a vote for the type of person you wish to become.",
  cfiRange: "epubcfi(/6/8!/4/2/14,/1:0,/1:75)",
  chapterHref: "chapter-2.xhtml",
};

// The composer draws its own top border and padding — the frame only supplies
// the panel width it normally sits at the bottom of.
const meta = {
  title: "Interface/AI/ChatComposer",
  component: ChatComposer,
  decorators: [
    (Story) => (
      <div className="max-w-md bg-paper pt-8">
        <Story />
      </div>
    ),
  ],
  args: {
    isStreaming: false,
    pendingAttachment: null,
    onRemoveAttachment: () => {},
    onSend: () => {},
    onStop: () => {},
  },
} satisfies Meta<typeof ChatComposer>;

export default meta;
type Story = StoryObj<typeof meta>;

/** At rest: the send affordance stays disabled until there's text or a passage. */
export const Idle: Story = {};

/** Mid-reply: the send button swaps for the stop affordance. */
export const Streaming: Story = {
  args: { isStreaming: true },
};

/** A passage pulled in via "Ask AI about this": the chip above the input, removable before sending. */
export const WithPendingAttachment: Story = {
  args: { pendingAttachment: PASSAGE },
};
