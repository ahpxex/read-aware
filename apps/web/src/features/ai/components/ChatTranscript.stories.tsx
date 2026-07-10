import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ChatAssistantPart, ChatMessage } from "../lib/chat-types";
import { ChatTranscript } from "./ChatTranscript";

const askedAt = "2026-07-06T09:00:00.000Z";

const userTurn: ChatMessage = {
  id: "u1",
  role: "user",
  content: "What do you remember about me, and how does it connect to this book?",
  createdAt: askedAt,
};

/** A full assistant turn: thinking → tool trace → Markdown with code + table. */
const richParts: ChatAssistantPart[] = [
  {
    type: "thinking",
    text: "The reader is asking about their profile. I should check long-term memory first, then their highlights, before answering from context.",
  },
  { type: "tool", id: "t1", tool: "search_memory", detail: "reading goals", state: "done" },
  { type: "tool", id: "t2", tool: "get_annotations", state: "done" },
  { type: "tool", id: "t3", tool: "search_book_text", detail: "deliberate practice", state: "error" },
  { type: "text", text: "Two books on your shelf circle the same argument:" },
  {
    type: "reference",
    id: "r1",
    reference: {
      kind: "books",
      books: [
        { bookId: "b1", title: "Atomic Habits", author: "James Clear" },
        { bookId: "b2", title: "Peak", author: "Anders Ericsson" },
      ],
    },
  },
  {
    type: "text",
    text: [
      "Here's what I know so far — and where it touches this book:",
      "",
      "| Memory | Source | Relevance |",
      "| --- | --- | --- |",
      "| You prefer primary sources | stated directly | High |",
      "| Reading toward a thesis on habit | recurring theme | High |",
      "| Skeptical of pop-science framing | inferred | Medium |",
      "",
      "The chapter you're in models its argument almost like a routine:",
      "",
      "```python",
      "def build_habit(cue, response):",
      "    reward = evaluate(response)",
      "    return reinforce(cue, response, reward)",
      "```",
      "",
      "Inline references like `reinforce()` map back to the case studies in chapter 3. Want me to pull the passages where the author tests this loop against the *deliberate practice* literature?",
    ].join("\n"),
  },
];

const conversation: ChatMessage[] = [
  userTurn,
  {
    id: "a1",
    role: "assistant",
    content: "Here's what I know so far — and where it touches this book…",
    createdAt: askedAt,
    parts: richParts,
  },
];

const meta = {
  title: "Features/AI/ChatTranscript",
  component: ChatTranscript,
  parameters: { layout: "fullscreen" },
  args: {
    messages: conversation,
    isLoading: false,
    isStreaming: false,
    streamingParts: [],
    status: null,
  },
  decorators: [
    (Story) => (
      <div className="flex h-[36rem] flex-col bg-fill">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ChatTranscript>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A settled turn: collapsed thinking, the tool trace (one failed), rich Markdown. */
export const Conversation: Story = {};

/** Before the first event of the reply: the transcript-level thinking row. */
export const WaitingForFirstToken: Story = {
  args: {
    messages: [userTurn],
    isStreaming: true,
  },
};

/** Mid-turn: reasoning is streaming in, collapsed behind the pulsing label. */
export const StreamingThinking: Story = {
  args: {
    messages: [userTurn],
    isStreaming: true,
    streamingParts: [
      {
        type: "thinking",
        text: "Let me look at what I already know about this reader before answering…",
      },
    ],
  },
};

/** Mid-turn: a tool call is running after some prose already landed. */
export const StreamingToolStep: Story = {
  args: {
    messages: [userTurn],
    isStreaming: true,
    streamingParts: [
      { type: "text", text: "Let me check your highlights before answering." },
      { type: "tool", id: "t1", tool: "search_memory", detail: "reading goals", state: "done" },
      { type: "tool", id: "t2", tool: "get_annotations", state: "running" },
    ],
  },
};

/** Between rounds: every tool settled, next model response not started — the
    thinking row keeps the turn visibly alive. */
export const AwaitingNextRound: Story = {
  args: {
    messages: [userTurn],
    isStreaming: true,
    streamingParts: [
      { type: "tool", id: "t1", tool: "search_memory", detail: "reading goals", state: "done" },
      { type: "tool", id: "t2", tool: "get_annotations", state: "done" },
    ],
  },
};

/** A failed turn with a partial reply: inline error row + retry on the message. */
export const FailedTurnPartialReply: Story = {
  args: {
    messages: [
      userTurn,
      {
        id: "a1",
        role: "assistant",
        content: "Here's what I know so far — before the connection dropped mid-",
        createdAt: askedAt,
        parts: [
          { type: "tool", id: "t1", tool: "search_memory", detail: "reading goals", state: "done" },
          { type: "text", text: "Here's what I know so far — before the connection dropped mid-" },
        ],
        error: "network error: connection reset",
      },
    ],
    onRetry: () => {},
  },
};

/** A failure before any prose (e.g. no API key): an error-only stub message. */
export const FailedBeforeFirstToken: Story = {
  args: {
    messages: [
      userTurn,
      {
        id: "a1",
        role: "assistant",
        content: "",
        createdAt: askedAt,
        error: "AI is not configured — add an API key in Settings → AI.",
      },
    ],
    onRetry: () => {},
  },
};

/** Legacy message shape (content only, no parts) still renders as plain Markdown. */
export const LegacyContentOnly: Story = {
  args: {
    messages: [
      userTurn,
      {
        id: "a1",
        role: "assistant",
        content:
          "Messages saved before the part timeline existed render exactly as before — **plain Markdown** from `content`.",
        createdAt: askedAt,
      },
    ],
  },
};
