import type { Meta, StoryObj } from "@storybook/react-vite";
import { Markdown } from "./Markdown";

// One sample exercising every element the reply surface styles: headings,
// list, table, fenced code, blockquote, inline code, emphasis.
const RICH_REPLY = [
  "## Identity-based habits",
  "",
  "The chapter's argument runs in three moves:",
  "",
  "1. Outcomes are lagging indicators of *systems*.",
  "2. Systems are lagging indicators of **identity**.",
  "3. Every action is a vote for the person you wish to become.",
  "",
  "### Where your highlights connect",
  "",
  "| Highlight | Chapter | Connection |",
  "| --- | --- | --- |",
  "| The voting metaphor | 2 | Direct statement of the thesis |",
  "| Deliberate practice passage | 3 | The mechanism behind the votes |",
  "",
  "The author models the loop almost like a routine:",
  "",
  "```python",
  "def cast_vote(identity, action):",
  "    evidence = observe(action)",
  "    return reinforce(identity, evidence)",
  "```",
  "",
  "> Every action you take is a vote for the type of person you wish to become.",
  "",
  "Inline references like `reinforce()` map back to the case studies in chapter 3.",
].join("\n");

const meta = {
  title: "Interface/AI/Markdown",
  component: Markdown,
  decorators: [
    (Story) => (
      <div className="max-w-xl bg-paper p-4">
        <Story />
      </div>
    ),
  ],
  args: { children: RICH_REPLY },
} satisfies Meta<typeof Markdown>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The full editorial surface: headings, list, table, code, blockquote — no copy chrome, no line numbers. */
export const RichReply: Story = {};

/** A mid-stream fragment: Streamdown renders unclosed Markdown without artifacts. */
export const StreamingFragment: Story = {
  args: {
    children: "The author frames habit change as a **compounding process — each repetition is",
  },
};
