import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ConversationSummary } from "../../ai/lib/conversation-store";
import { ThreadsPopoverView } from "./ThreadsPopoverView";

function thread(id: string, preview: string, daysAgo: number): ConversationSummary {
  const updated = new Date(Date.UTC(2026, 5, 28) - daysAgo * 86_400_000);
  return { id, preview, updatedAt: updated.toISOString(), messageCount: 4 + daysAgo };
}

const threads: ConversationSummary[] = [
  thread("t1", "What links Pale Fire's foreword to its index?", 0),
  thread("t2", "Summarize what I've marked across all my books this month", 2),
  thread("t3", "Explain Wittgenstein's picture theory in plain language", 9),
  thread("t4", "Which books have I started but not finished?", 21),
];

/**
 * The global thread switcher.
 *
 * The header only lists past conversations — starting a new one is a separate,
 * adjacent header action rather than a row hidden inside the panel. Deletion
 * is an on-hover affordance in the row, matching AnnotationRow, and the panel
 * deliberately stays open through it so several can be cleared in a row.
 *
 * Stories render it open, since the closed state is one icon.
 */
const meta = {
  title: "Interface/Context/ThreadsPopover",
  component: ThreadsPopoverView,
  parameters: { layout: "centered" },
  args: {
    open: true,
    threads,
    activeThreadId: "t1",
    onOpenChange: () => {},
    onSelect: () => {},
    onDelete: () => {},
  },
} satisfies Meta<typeof ThreadsPopoverView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Several saved threads, the first one active. */
export const Default: Story = {};

/**
 * The active thread has no messages committed yet, so it isn't in the list.
 * It gets a placeholder row at the top rather than leaving nothing selected.
 */
export const UnsavedActiveThread: Story = {
  args: { activeThreadId: "brand-new" },
};

/** A thread whose preview is empty falls back to the placeholder title. */
export const ThreadWithoutPreview: Story = {
  args: {
    threads: [{ ...threads[0], preview: "   " }, ...threads.slice(1)],
  },
};

/** Long first questions truncate to one line rather than wrapping. */
export const LongTitles: Story = {
  args: {
    threads: threads.map((entry, i) => ({
      ...entry,
      preview: `A question long enough that it cannot possibly fit on a single line of this panel, number ${i + 1}`,
    })),
  },
};

/** Many threads scroll inside the panel's height cap. */
export const ManyThreads: Story = {
  args: {
    threads: Array.from({ length: 25 }, (_, i) =>
      thread(`t${i}`, `Conversation number ${i + 1}`, i),
    ),
    activeThreadId: "t0",
  },
};

/** A fresh install: no saved threads, only the unsaved active one. */
export const NoSavedThreads: Story = {
  args: { threads: [], activeThreadId: "brand-new" },
};

/** Closed — the trigger alone, as it sits in the header. */
export const Closed: Story = {
  args: { open: false },
};
