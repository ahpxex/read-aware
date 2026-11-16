import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { AgentWelcome } from "./AgentWelcome";

/**
 * An empty Agent conversation: the ReadAware mark, what the page is for, four
 * ways in (a different mix each conversation; these four are fixed for the
 * story), and the keys for the thread palette and a new conversation. A way
 * in fills the composer and never sends, so it can be edited first.
 */
const meta = {
  title: "Interface/Agent/AgentWelcome",
  component: AgentWelcome,
  parameters: { layout: "centered" },
  args: {
    suggestions: ["readingMonth", "disagree", "organize", "reviews"],
    onSuggest: fn(),
    searchKeys: ["⌘", "K"],
    newConversationKeys: ["⌘", "N"],
  },
} satisfies Meta<typeof AgentWelcome>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** A way in hands its prompt to the composer. */
export const ChoosingAWayIn: Story = {
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: /collections by genre/ }));
    await expect(args.onSuggest).toHaveBeenCalledWith("Sort the books on my shelf into collections by genre.");
  },
};

/** On a phone the ways in stack. */
export const Phone: Story = {
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
