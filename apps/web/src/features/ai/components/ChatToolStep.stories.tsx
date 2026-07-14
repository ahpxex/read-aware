import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChatToolStep } from "./ChatToolStep";

const meta = {
  title: "Interface/AI/ChatToolStep",
  component: ChatToolStep,
  decorators: [
    (Story) => (
      <div className="max-w-md bg-paper p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ChatToolStep>;

export default meta;
type Story = StoryObj<typeof meta>;

/** In flight: a spinner in the chevron slot, label brightened, distilled argument after the dot. */
export const Running: Story = {
  args: {
    part: { type: "tool", id: "t1", tool: "search_memory", detail: "reading goals", state: "running" },
  },
};

/** Settled: back to the quiet chevron row (no detail when the arguments were opaque). */
export const Done: Story = {
  args: {
    part: { type: "tool", id: "t2", tool: "get_annotations", state: "done" },
  },
};

/** Failed: an understated plain-text suffix — no red banner. */
export const Failed: Story = {
  args: {
    part: { type: "tool", id: "t3", tool: "search_book_text", detail: "deliberate practice", state: "error" },
  },
};

/** A tool name outside the label map (a future backend's) falls back to the generic row instead of disappearing. */
export const UnknownTool: Story = {
  args: {
    part: { type: "tool", id: "t4", tool: "summarize_chapter", detail: "chapter 3", state: "done" },
  },
};
