import type { Meta, StoryObj } from "@storybook/react-vite";
import { SyncProgressDetail } from "./SyncProgressDetail";
import {
  backlog,
  downloadingBook,
  failed,
  failedWithoutMessage,
  idle,
  neverSynced,
  pulling,
  pushing,
  singleBlobNoTotals,
  snapshot,
  unauthenticated,
  uploadingBook,
} from "./sync.fixtures";

/**
 * The sync facts as a quiet metadata strip. Editorial restraint is the point:
 * an item renders only when it has something to say, so most of these stories
 * are about what is *absent*.
 *
 * A thin bar tracks the cycle only while the denominators are honest — the
 * pull phase stays textual, because its total is unknowable.
 */
const meta = {
  title: "Interface/Sync/SyncProgressDetail",
  component: SyncProgressDetail,
  parameters: { layout: "padded" },
  args: { status: idle, backlog: null },
  decorators: [
    (Story) => (
      <div className="w-72 rounded-md border border-border bg-surface p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SyncProgressDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Settled: the last sync time and what the last cycle moved. */
export const Idle: Story = {};

/** Connected but never synced — "never", not a blank line. */
export const NeverSynced: Story = {
  args: { status: neverSynced },
};

/** Pulling: a count, an indeterminate ring, and deliberately no bar. */
export const Pulling: Story = {
  args: { status: pulling },
};

/** Pushing, where the outbox size gives an honest fraction — so a bar appears. */
export const Pushing: Story = {
  args: { status: pushing },
};

/** Uploading a book, with its title resolved by the caller. */
export const UploadingBook: Story = {
  args: { status: uploadingBook, movingTitle: "Pale Fire" },
};

/** Downloading a book from another device. */
export const DownloadingBook: Story = {
  args: { status: downloadingBook, movingTitle: "The Sea, The Sea" },
};

/**
 * A blob is moving but its title didn't resolve (an id this device has never
 * seen). The line is dropped rather than printing a raw blob key.
 */
export const MovingBookWithoutTitle: Story = {
  args: { status: uploadingBook, movingTitle: null },
};

/** A lazy fetch outside a cycle: part counters alone still make a fraction. */
export const SingleBlobWithoutCycleTotals: Story = {
  args: { status: singleBlobNoTotals, movingTitle: "The Annals of the Former World" },
};

/** Work owed to the relay, shown while the popover polls the outbox. */
export const WithBacklog: Story = {
  args: { backlog },
};

/** An empty outbox says nothing at all — no "0 pending" line. */
export const EmptyBacklogIsSilent: Story = {
  args: { backlog: { events: 0, blobs: 0 } },
};

/** A cycle that moved nothing is likewise not worth a line. */
export const AllZeroLastCycleIsSilent: Story = {
  args: { status: snapshot({ lastCycle: { pulled: 0, pushed: 0, blobs: 0 } }) },
};

/** A failure, in the relay's own words. */
export const Failed: Story = {
  args: { status: failed },
};

/** A failure with no message — the generic wording stands in. */
export const FailedWithoutMessage: Story = {
  args: { status: failedWithoutMessage },
};

/** The session was rejected: terminal, and worded as sign-in rather than error. */
export const Unauthenticated: Story = {
  args: { status: unauthenticated },
};

/** Everything at once: a running cycle, a backlog, and a book in flight. */
export const Crowded: Story = {
  args: { status: uploadingBook, backlog, movingTitle: "Pale Fire" },
};
