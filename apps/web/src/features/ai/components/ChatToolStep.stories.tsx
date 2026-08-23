import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChatToolStep } from "./ChatToolStep";

const meta = {
  title: "Interface/AI/ChatToolStep",
  component: ChatToolStep,
  decorators: [
    (Story) => (
      <div className="max-w-md bg-[var(--ra-main-surface-color)] p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ChatToolStep>;

export default meta;
type Story = StoryObj<typeof meta>;

/** In flight: expanded automatically so the live input and progress are visible. */
export const Running: Story = {
  args: {
    part: {
      type: "tool",
      id: "t1",
      tool: "search_memory",
      detail: "reading goals",
      input: '{\n  "query": "reading goals"\n}',
      state: "running",
    },
  },
};

/** Settled: collapses immediately, with both the input and result available on demand. */
export const Done: Story = {
  args: {
    part: {
      type: "tool",
      id: "t2",
      tool: "get_annotations",
      input: "{}",
      output: '{\n  "annotations": []\n}',
      state: "done",
    },
  },
};

/** Failed: an understated plain-text suffix — no red banner. */
export const Failed: Story = {
  args: {
    part: {
      type: "tool",
      id: "t3",
      tool: "search_book_text",
      detail: "deliberate practice",
      input: '{\n  "queries": ["deliberate practice"]\n}',
      output: "Chapter text is unavailable.",
      state: "error",
    },
  },
};

/** A tool name outside the label map (a future backend's) falls back to the generic row instead of disappearing. */
export const UnknownTool: Story = {
  args: {
    part: { type: "tool", id: "t4", tool: "summarize_chapter", detail: "chapter 3", state: "done" },
  },
};
