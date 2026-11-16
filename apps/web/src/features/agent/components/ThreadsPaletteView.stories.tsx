import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import type { ThreadSummary } from "@read-aware/core";
import { describeError } from "../../../i18n";
import { ThreadsPaletteView, type ThreadsPaletteViewProps } from "./ThreadsPaletteView";

/** A fixed clock, so the date groups are stable: Monday 16 November 2026, 09:00 local. */
const now = new Date(2026, 10, 16, 9).getTime();
const hoursAgo = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString();

const threads: ThreadSummary[] = [
  {
    id: "thread-1",
    title: "近一个月的阅读时长",
    preview: "我最近一个月大概读了多少时间？读得最多的是哪本书？",
    updatedAt: hoursAgo(1),
  },
  { id: "thread-2", title: "Find a photo of the Millau Viaduct and describe it in one line", updatedAt: hoursAgo(3) },
  { id: "thread-3", title: "非洲长啥样", updatedAt: daysAgo(1) },
  { id: "thread-4", title: "Which of my novels are about memory?", updatedAt: daysAgo(4) },
  { id: "thread-5", title: "Sort the novels on my shelf into lists by genre", updatedAt: daysAgo(12) },
  { id: "thread-6", title: "Summarise what I highlighted in Pale Fire", updatedAt: daysAgo(45) },
  { id: "thread-7", title: "", updatedAt: daysAgo(80) },
];

/** The palette as the Agent page drives it: the list and the open thread live outside. */
function Interactive(props: Partial<ThreadsPaletteViewProps>) {
  const [list, setList] = useState(props.threads ?? threads);
  const [active, setActive] = useState(props.activeThreadId ?? "thread-1");
  return (
    <ThreadsPaletteView
      open
      onClose={() => {}}
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
  );
}

/**
 * The Agent page's thread switcher, opened from the header's Threads button:
 * the same palette as ⌘K. The search has focus, ↑/↓ move the highlight and
 * Enter opens; threads are grouped by when each was last active, each with
 * its time, the open one checked. Delete sits at a row's end on hover or
 * while the row is highlighted.
 */
const meta = {
  title: "Interface/Agent/ThreadsPalette",
  component: Interactive,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Interactive>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Today, yesterday, the previous week and month, then by month. A titled
 * thread shows its generated title (the first one here); the rest show their
 * first message until they have one, and a thread with neither reads "New
 * conversation".
 */
export const Grouped: Story = {};

/** Typing filters titles and first messages; ↓ moves the highlight and Enter opens the highlighted thread. */
export const SearchAndKeyboard: Story = {
  play: async () => {
    const page = within(document.body);
    const field = await page.findByRole("searchbox", { name: "Search conversations" });
    await waitFor(() => expect(field).toHaveFocus());
    await userEvent.type(field, "novels");
    await expect(page.queryByText("非洲长啥样")).toBeNull();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await waitFor(() =>
      expect(page.getByRole("button", { name: /Sort the novels/ })).toHaveAttribute("aria-current", "true"),
    );
  },
};

/** A titled thread is still found by the reader's own first words. */
export const SearchByFirstMessage: Story = {
  play: async () => {
    const page = within(document.body);
    const field = await page.findByRole("searchbox", { name: "Search conversations" });
    await userEvent.type(field, "读得最多");
    await expect(page.getByRole("button", { name: /近一个月的阅读时长/ })).toBeVisible();
  },
};

/** No stored thread yet. */
export const Empty: Story = {
  args: { threads: [] },
};

/** The first read. */
export const Loading: Story = {
  args: { threads: [], isLoading: true },
};

/** The list could not be read: an error with a retry, never an empty list. */
export const Failed: Story = {
  args: { threads: [], loadFailure: { ...describeError(new Error("fixture")), retryable: true } },
};
