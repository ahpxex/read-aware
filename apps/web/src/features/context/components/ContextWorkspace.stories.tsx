import type { Meta, StoryObj } from "@storybook/react-vite";
import { activeGlobalThreadAtom } from "../../ai/state/global-thread";
import { seed, withAtoms } from "../../../story-support/atoms";
import { ContextWorkspace } from "./ContextWorkspace";

/**
 * The Context page: the home of the global, cross-book thread.
 *
 * The page *is* the chat — there is no sidebar. Switching and creating threads
 * happens in the header's popovers, and the active thread reaches this surface
 * through an atom; memory never splits per thread, so nothing here is
 * thread-scoped but the transcript.
 *
 * Messages load from the conversation store over Tauri IPC, so the transcript
 * renders empty in Storybook; `ChatTranscript` covers the populated and
 * streaming states.
 */
const meta = {
  title: "Interface/Context/ContextWorkspace",
  component: ContextWorkspace,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="h-[36rem] w-full">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ContextWorkspace>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A new, empty thread — the composer takes focus on entry. */
export const EmptyThread: Story = {
  decorators: [withAtoms(seed(activeGlobalThreadAtom, "global-new"))],
};

/**
 * A different thread selected. The composer re-focuses on every switch, which
 * is why the thread id is the effect's dependency rather than mount alone.
 */
export const AnotherThread: Story = {
  decorators: [withAtoms(seed(activeGlobalThreadAtom, "global-2026-06-20"))],
};
