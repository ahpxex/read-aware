import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChatPanel } from "./ChatPanel";

/**
 * The book's AI conversation as panel content — the note panel owns the tab
 * chrome around it.
 *
 * One persistent conversation per book: "Ask AI about this" feeds a passage
 * into the composer as an attachment rather than opening a new thread, and
 * continuity lives in the memory layer, not in a transcript this panel keeps.
 *
 * What this component actually owns is that composition and its wiring — the
 * focus gesture, the attachment hand-off. The transcript itself comes from the
 * conversation store over Tauri IPC, so it renders empty here; `ChatTranscript`
 * and `ChatComposer` carry the message and streaming states in their own
 * stories.
 *
 * Hence only two stories. The panel's other props — the book title, the live
 * reading cursor — change nothing you can see: the title belongs to the note
 * panel's chrome, and the cursor is sampled at send time. Stories for them
 * rendered byte-identical markup, which is worse than no story at all.
 */
const meta = {
  title: "Interface/AI/ChatPanel",
  component: ChatPanel,
  parameters: { layout: "fullscreen" },
  args: { bookId: "book-pale-fire", bookTitle: "Pale Fire" },
  decorators: [
    (Story) => (
      <div className="flex h-[36rem] w-full max-w-lg flex-col border-l border-border">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ChatPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A fresh book thread: empty transcript, composer ready. */
export const Default: Story = {};

/**
 * The one state this panel alone can show. The host reports the panel was just
 * *opened*, and only that gesture puts the caret in the composer — it is
 * deliberately not a "panel is visible" flag, because the panel also returns to
 * view whenever dismissed reader chrome comes back, and focusing there would
 * raise a phone's keyboard over a page the reader only meant to look at.
 */
export const FocusedOnOpen: Story = {
  args: { focusRequestId: 1 },
};
