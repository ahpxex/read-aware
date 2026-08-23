import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ChatSelectionAttachment } from "../lib/chat-types";
import { ChatComposer } from "./ChatComposer";

const PASSAGE: ChatSelectionAttachment = {
  kind: "selection",
  text: "Every action you take is a vote for the type of person you wish to become.",
  cfiRange: "epubcfi(/6/8!/4/2/14,/1:0,/1:75)",
  chapterHref: "chapter-2.xhtml",
};

// Long enough to overflow the attachment chip's three-line clamp.
const LONG_PASSAGE: ChatSelectionAttachment = {
  kind: "selection",
  text: "It is a simple two-step process: decide the type of person you want to be, then prove it to yourself with small wins. Your habits are how you embody your identity — when you make your bed each day, you embody the identity of an organized person; when you write each day, you embody the identity of a creative person. The more you repeat a behavior, the more you reinforce the identity associated with that behavior.",
  cfiRange: "epubcfi(/6/8!/4/2/22,/1:0,/3:118)",
  chapterHref: "chapter-2.xhtml",
};

/**
 * The composer, including the attachment chip.
 *
 * The chip has no stories of its own: it never appears alone — it is either
 * pending in this composer (removable) or read-only on a sent turn, which is
 * `ChatMessageItem`'s UserTurnWithAttachment.
 *
 * The composer draws its own top border and padding — the frame only supplies
 * the panel width it normally sits at the bottom of.
 */
const meta = {
  title: "Interface/AI/ChatComposer",
  component: ChatComposer,
  decorators: [
    (Story) => (
      <div className="max-w-md bg-[var(--ra-main-surface-color)] pt-8">
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

/**
 * A long passage. The chip clamps to three lines and keeps its remove button
 * pinned top-right, so the composer cannot be pushed off screen by a greedy
 * selection.
 */
export const WithLongAttachment: Story = {
  args: { pendingAttachment: LONG_PASSAGE },
};
