import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ChatSelectionAttachment } from "../lib/chat-types";
import { AttachmentChip } from "./AttachmentChip";

const SHORT: ChatSelectionAttachment = {
  kind: "selection",
  text: "Every action you take is a vote for the type of person you wish to become.",
  cfiRange: "epubcfi(/6/8!/4/2/14,/1:0,/1:75)",
  chapterHref: "chapter-2.xhtml",
};

// Long enough to overflow the chip's 3-line clamp.
const LONG: ChatSelectionAttachment = {
  kind: "selection",
  text: "It is a simple two-step process: decide the type of person you want to be, then prove it to yourself with small wins. Your habits are how you embody your identity — when you make your bed each day, you embody the identity of an organized person; when you write each day, you embody the identity of a creative person. The more you repeat a behavior, the more you reinforce the identity associated with that behavior.",
  cfiRange: "epubcfi(/6/8!/4/2/22,/1:0,/3:118)",
  chapterHref: "chapter-2.xhtml",
};

const meta = {
  title: "Interface/AI/AttachmentChip",
  component: AttachmentChip,
  decorators: [
    (Story) => (
      <div className="max-w-sm bg-paper p-4">
        <Story />
      </div>
    ),
  ],
  args: { attachment: SHORT },
} satisfies Meta<typeof AttachmentChip>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A short quoted passage in the composer, removable before sending. */
export const ShortPassage: Story = {
  args: { onRemove: () => {} },
};

/** A long passage clamps to three lines; the remove button stays pinned top-right. */
export const LongPassage: Story = {
  args: { attachment: LONG, onRemove: () => {} },
};

/** On the sent user turn the chip renders read-only — no remove affordance. */
export const OnSentTurn: Story = {};
