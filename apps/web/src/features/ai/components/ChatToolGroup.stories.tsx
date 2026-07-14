import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ChatToolPart } from "../lib/chat-types";
import { ChatToolGroup } from "./ChatToolGroup";

const SETTLED_RUN: ChatToolPart[] = [
  { type: "tool", id: "t1", tool: "search_memory", detail: "reading goals", state: "done" },
  { type: "tool", id: "t2", tool: "get_annotations", state: "done" },
  { type: "tool", id: "t3", tool: "read_chapter", detail: "#3", state: "done" },
];

const meta = {
  title: "Interface/AI/ChatToolGroup",
  component: ChatToolGroup,
  decorators: [
    (Story) => (
      <div className="max-w-md bg-paper p-4">
        <Story />
      </div>
    ),
  ],
  args: { parts: SETTLED_RUN },
} satisfies Meta<typeof ChatToolGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every step settled cleanly: a single quiet "N steps" line, expandable to the full trace. */
export const AllDone: Story = {};

/** A failed step inside the run: the collapsed summary carries the failure suffix before expanding. */
export const WithFailedStep: Story = {
  args: {
    parts: [
      { type: "tool", id: "t1", tool: "search_memory", detail: "reading goals", state: "done" },
      { type: "tool", id: "t2", tool: "search_book_text", detail: "deliberate practice", state: "error" },
      { type: "tool", id: "t3", tool: "get_annotations", state: "done" },
    ],
  },
};
