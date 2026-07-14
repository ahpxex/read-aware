import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChatMessageItem } from "./ChatMessageItem";

const sentAt = "2026-07-06T09:00:00.000Z";

const meta = {
  title: "Interface/AI/ChatMessageItem",
  component: ChatMessageItem,
  decorators: [
    (Story) => (
      <div className="max-w-md bg-paper p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ChatMessageItem>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A user turn: the quoted passage chip stacked above the right-aligned message chip. */
export const UserTurnWithAttachment: Story = {
  args: {
    message: {
      id: "u1",
      role: "user",
      content: "What does the author mean by identity-based habits here?",
      createdAt: sentAt,
      attachments: [
        {
          kind: "selection",
          text: "Every action you take is a vote for the type of person you wish to become.",
          cfiRange: "epubcfi(/6/8!/4/2/14,/1:0,/1:75)",
          chapterHref: "chapter-2.xhtml",
        },
      ],
    },
  },
};

/** A settled assistant turn: the run of ≥2 consecutive tool parts folds behind "N steps", prose follows. */
export const SettledAssistantTurn: Story = {
  args: {
    message: {
      id: "a1",
      role: "assistant",
      content:
        "The author's claim is that habits are identity votes: each repetition is small evidence for the person you're becoming.",
      createdAt: sentAt,
      parts: [
        {
          type: "thinking",
          text: "Their highlights cluster around the voting metaphor — start there instead of re-explaining the habit loop.",
        },
        { type: "tool", id: "t1", tool: "search_memory", detail: "identity habits", state: "done" },
        { type: "tool", id: "t2", tool: "get_annotations", state: "done" },
        {
          type: "text",
          text: "The author's claim is that habits are **identity votes**: each repetition is small evidence for the person you're becoming. Your highlight of the voting metaphor in chapter 2 is the thesis stated directly.",
        },
      ],
    },
  },
};

/** A failed turn (recognized code): the always-visible error card carries retry — no hover regenerate doubling it. */
export const FailedTurn: Story = {
  args: {
    message: {
      id: "a2",
      role: "assistant",
      content: "",
      createdAt: sentAt,
      error: "AI is not configured — add an API key in Settings → AI.",
      errorCode: "ai-not-configured",
    },
    onRetry: () => {},
  },
};
