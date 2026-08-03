import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import type { ChatInteractionAnswer, ChatInteractionPart } from "../lib/chat-types";
import { ChatInteractionPrompt } from "./ChatInteractionPrompt";

const question: ChatInteractionPart = {
  type: "interaction",
  id: "story-question",
  state: "pending",
  request: {
    id: "story-question",
    threadKey: "global:storybook",
    kind: "question",
    question: "How should I organize these books?",
    options: [
      {
        id: "theme",
        label: "By theme",
        description: "Group books around the ideas and subjects they share.",
      },
      {
        id: "status",
        label: "By reading status",
        description: "Separate unread, active, and finished books.",
      },
      {
        id: "language",
        label: "By language",
        description: "Keep books in the same reading language together.",
      },
    ],
    allowCustom: true,
  },
};

const permission: ChatInteractionPart = {
  type: "interaction",
  id: "story-permission",
  state: "pending",
  request: {
    id: "story-permission",
    threadKey: "global:storybook",
    kind: "permission",
    action: "delete-book",
    subject: "A Room with a View",
  },
};

const answeredQuestion: ChatInteractionPart = {
  ...question,
  state: "answered",
  answer: {
    optionId: "theme",
    text: "By theme",
  },
};

function InteractiveStory({ initialPart }: { initialPart: ChatInteractionPart }) {
  const [part, setPart] = useState(initialPart);

  function respond(id: string, answer: ChatInteractionAnswer): boolean {
    if (part.id !== id || part.state !== "pending") return false;
    setPart({
      ...part,
      state: answer.cancelled ? "cancelled" : "answered",
      answer,
    });
    return true;
  }

  return <ChatInteractionPrompt part={part} onRespond={respond} />;
}

const meta = {
  title: "Interface/AI/ChatInteractionPrompt",
  component: ChatInteractionPrompt,
  parameters: { controls: { disable: true } },
  decorators: [
    (Story) => (
      <div className="max-w-lg bg-[var(--ra-main-surface-color)] p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ChatInteractionPrompt>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A blocking clarification with suggested choices, custom input, and skip. */
export const AskQuestion: Story = {
  args: { part: question },
  render: () => <InteractiveStory initialPart={question} />,
};

/** A completed question returns to the same compact disclosure rhythm as tools and thinking. */
export const AnsweredQuestion: Story = {
  args: { part: answeredQuestion },
};

/** A host-enforced destructive-action confirmation; try either decision. */
export const Permission: Story = {
  args: { part: permission },
  render: () => <InteractiveStory initialPart={permission} />,
};
