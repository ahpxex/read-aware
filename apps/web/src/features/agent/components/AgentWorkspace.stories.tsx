import type { Meta, StoryObj } from "@storybook/react-vite";
import { activeGlobalThreadAtom } from "../../ai/state/global-thread";
import { GLOBAL_CONVERSATION_ID } from "../../ai/lib/conversation-store";
import { seed, withAtoms } from "../../../story-support/atoms";
import { AgentWorkspace } from "./AgentWorkspace";

/**
 * The Agent page: the home of the global, cross-book thread.
 *
 * The page is the conversation. New conversation and the thread switcher
 * sit in the header (see `AgentHeaderActions`; Threads opens `ThreadsPalette`); the
 * active thread is an atom both write; memory never splits per thread, so
 * nothing here is thread-scoped but the transcript.
 *
 * Messages load from the conversation store over Tauri IPC, so the
 * transcript renders empty in Storybook; `ChatTranscript` covers the
 * populated and streaming states.
 */
const meta = {
  title: "Interface/Agent/AgentWorkspace",
  component: AgentWorkspace,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="h-[36rem] w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AgentWorkspace>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A new, empty thread — the composer takes focus on entry. A fixed id in the
 * shape `newGlobalThreadId` mints (`thread-<uuid>`), so the story is stable.
 */
export const EmptyThread: Story = {
  decorators: [withAtoms(seed(activeGlobalThreadAtom, "thread-00000000-0000-4000-8000-000000000001"))],
};

/**
 * A different thread selected. The composer re-focuses on every switch, which
 * is why the thread id is the effect's dependency rather than mount alone.
 */
export const AnotherThread: Story = {
  decorators: [withAtoms(seed(activeGlobalThreadAtom, GLOBAL_CONVERSATION_ID))],
};
