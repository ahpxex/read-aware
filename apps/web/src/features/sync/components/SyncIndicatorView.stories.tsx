import type { Meta, StoryObj } from "@storybook/react-vite";
import { SyncIndicatorView } from "./SyncIndicatorView";
import {
  backlog,
  failed,
  failedWithoutMessage,
  idle,
  pulling,
  pushing,
  uploadingBook,
} from "./sync.fixtures";

/**
 * The header sync chip.
 *
 * In the app it is almost never on screen — the header speaks only on failure,
 * and the visibility policy that enforces that lives in the container. This
 * view renders whatever it is handed, which is what makes the running states
 * reviewable at all.
 *
 * Stories default to the popover open, since the closed chip is one line.
 */
const meta = {
  title: "Interface/Sync/SyncIndicator",
  component: SyncIndicatorView,
  parameters: { layout: "centered" },
  args: {
    status: failed,
    backlog: null,
    open: false,
    onOpenChange: () => {},
    onSyncNow: () => {},
    onDismissError: () => {},
  },
  decorators: [
    (Story) => (
      <div className="flex w-[26rem] items-center justify-end rounded-md border border-border bg-surface px-3 py-2">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SyncIndicatorView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The state the header actually shows: a failure, with its dismiss affordance. */
export const Failed: Story = {};

/** The failure's popover: the diagnostic plus a retry. */
export const FailedPopoverOpen: Story = {
  args: { open: true },
};

/** A failure with no message from the relay. */
export const FailedWithoutMessage: Story = {
  args: { status: failedWithoutMessage, open: true },
};

/**
 * A retry running after a failure — the chip stays mounted through the cycle
 * because the popover is open, and the retry button is disabled meanwhile.
 */
export const RetryRunning: Story = {
  args: { status: pushing, open: true, backlog },
};

/** Pulling: the ring spins rather than claiming a percentage. */
export const PullingIndeterminate: Story = {
  args: { status: pulling, open: true },
};

/** Uploading a book, with the title and part counters in the popover. */
export const UploadingBook: Story = {
  args: { status: uploadingBook, open: true, movingTitle: "Pale Fire", backlog },
};

/** The chip closed, mid-cycle: the label carries the percentage. */
export const SyncingClosed: Story = {
  args: { status: pushing },
};

/** Settled — no dismiss affordance, since there is no error to snooze. */
export const IdlePopoverOpen: Story = {
  args: { status: idle, open: true },
};
