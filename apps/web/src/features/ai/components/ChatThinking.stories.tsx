import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChatThinking } from "./ChatThinking";

// Long enough to overflow the streaming tail's max-h-24 window — that's what
// arms the top fade mask.
const LONG_THOUGHT = [
  "The reader is asking about identity-based habits in chapter 2.",
  "Their highlights cluster around the voting metaphor, so the answer should start there rather than re-explaining the habit loop from chapter 1.",
  "They prefer primary sources — quote the author's own framing, then connect it to the deliberate-practice passage they marked last week.",
  "I should check long-term memory for their stated reading goal before committing to an angle.",
].join(" ");

const meta = {
  title: "Interface/AI/ChatThinking",
  component: ChatThinking,
  decorators: [
    (Story) => (
      <div className="max-w-md bg-paper p-4">
        <Story />
      </div>
    ),
  ],
  args: { text: LONG_THOUGHT },
} satisfies Meta<typeof ChatThinking>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Mid-stream: the tail renders live under the pulsing label, bottom-anchored, top fading out. */
export const Streaming: Story = {
  args: { streaming: true },
};

/** A short streaming thought: no overflow yet, so no fade mask on the first lines. */
export const StreamingShort: Story = {
  args: {
    streaming: true,
    text: "Checking the reader's highlights before answering.",
  },
};

/** Settled: the run collapses behind the quiet "Thought process" disclosure. */
export const Settled: Story = {};
