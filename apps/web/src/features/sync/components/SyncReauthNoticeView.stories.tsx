import type { Meta, StoryObj } from "@storybook/react-vite";
import { SyncReauthNoticeView } from "./SyncReauthNoticeView";

/**
 * The prompt for a session the relay has rejected. It sits in the same leading
 * status slot as the update surfaces and follows the same manners: quiet, one
 * line, dismissible.
 *
 * Whether it appears — a dead session that hasn't been silenced yet — is the
 * container's decision, so this view is simply always visible.
 */
const meta = {
  title: "Interface/Sync/SyncReauthNotice",
  component: SyncReauthNoticeView,
  parameters: { layout: "centered" },
  args: { onOpenSettings: () => {}, onDismiss: () => {} },
} satisfies Meta<typeof SyncReauthNoticeView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The notice on its own. */
export const Default: Story = {};

/** In situ: the header's leading status slot, beside the rest of the chrome. */
export const InHeaderSlot: Story = {
  render: (args) => (
    <div className="flex w-[30rem] items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
      <SyncReauthNoticeView {...args} />
      <span className="ml-auto text-sm text-fg-subtle">Library</span>
    </div>
  ),
};

/** On the paper canvas, which is what it actually sits on. */
export const OnPaper: Story = {
  decorators: [
    (Story) => (
      <div className="rounded-md bg-paper px-3 py-2">
        <Story />
      </div>
    ),
  ],
};
