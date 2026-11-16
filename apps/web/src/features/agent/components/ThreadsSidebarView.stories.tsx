import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import type { ThreadSummary } from "@read-aware/core";
import { describeError } from "../../../i18n";
import { ThreadsSidebarView, type ThreadsSidebarViewProps } from "./ThreadsSidebarView";

/** A fixed clock, so the date groups are stable: Monday 16 November 2026, 09:00 local. */
const now = new Date(2026, 10, 16, 9).getTime();
const hoursAgo = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString();

const threads: ThreadSummary[] = [
  { id: "thread-1", title: "我最近一个月大概读了多少时间？读得最多的是哪本书？", updatedAt: hoursAgo(1) },
  { id: "thread-2", title: "Find a photo of the Millau Viaduct and describe it in one line", updatedAt: hoursAgo(3) },
  { id: "thread-3", title: "非洲长啥样", updatedAt: daysAgo(1) },
  { id: "thread-4", title: "Which of my novels are about memory?", updatedAt: daysAgo(4) },
  { id: "thread-5", title: "Sort the novels on my shelf into lists by genre", updatedAt: daysAgo(12) },
  { id: "thread-6", title: "Summarise what I highlighted in Pale Fire", updatedAt: daysAgo(45) },
  { id: "thread-7", title: "", updatedAt: daysAgo(80) },
];

function Interactive(props: Partial<ThreadsSidebarViewProps>) {
  const [list, setList] = useState(props.threads ?? threads);
  const [active, setActive] = useState(props.activeThreadId ?? "thread-1");
  return (
    <div className="h-[36rem] w-64 border-r border-border bg-[var(--ra-main-surface-color)]">
      <ThreadsSidebarView
        isLoading={false}
        loadFailure={null}
        onRetry={() => {}}
        now={now}
        {...props}
        threads={list}
        activeThreadId={active}
        onSelect={setActive}
        onDelete={(id) => setList((current) => current.filter((thread) => thread.id !== id))}
      />
    </div>
  );
}

/**
 * The Agent page's threads, docked at its left edge (a drawer on a phone):
 * grouped by when each was last active, the open one marked, a search over
 * their titles above. Deleting is at a row's end on hover.
 */
const meta = {
  title: "Interface/Agent/ThreadsSidebar",
  component: Interactive,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Interactive>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Today, yesterday, the previous week and month, then by month. An untitled thread reads "New conversation". */
export const Grouped: Story = {};

/** A new conversation before its first turn is not stored yet; it still heads the list as the open thread. */
export const UnsavedNewThread: Story = {
  args: { activeThreadId: "thread-new" },
};

/** Searching the titles. */
export const Searching: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole("searchbox", { name: "Search conversations" }), "novels");
    await expect(canvas.getAllByRole("button", { name: /novels/ })).toHaveLength(2);
    await expect(canvas.queryByText("非洲长啥样")).toBeNull();
  },
};

/** No thread yet but the open, unsaved one. */
export const Empty: Story = {
  args: { threads: [], activeThreadId: "thread-new" },
};

/** The first read. */
export const Loading: Story = {
  args: { threads: [], isLoading: true },
};

/** The list could not be read: an error with a retry, never an empty list. */
export const Failed: Story = {
  args: {
    threads: [],
    loadFailure: { ...describeError(new Error("fixture")), retryable: true },
  },
};
