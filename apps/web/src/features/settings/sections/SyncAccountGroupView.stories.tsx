import type { Meta, StoryObj } from "@storybook/react-vite";
import type { SyncTier } from "@read-aware/core";
import type { SyncProfile } from "../../../platform/sync/sync-store";
import {
  backlog,
  failed,
  idle,
  snapshot,
  unauthenticated,
  uploadingBook,
} from "../../sync/components/sync.fixtures";
import type { SyncBookBacklogRow } from "../../sync/hooks/useSyncStatus";
import type { SyncAccountInfo } from "../hooks/useSyncAccountInfo";
import type { useSyncConnection } from "../hooks/useSyncConnection";
import { SyncAccountGroupView } from "./SyncAccountGroupView";

const MB = 1024 * 1024;
const GB = 1024 * MB;

const profile: SyncProfile = {
  syncEnabled: true,
  remoteAccountId: "acct_9f4c2b7ae1d0",
  encryptionKeyRef: "key_local",
  lastPushAt: "2026-06-28T20:14:00.000Z",
  lastPullAt: "2026-06-28T20:14:00.000Z",
};

function account(
  tier: SyncTier,
  patch: Partial<SyncAccountInfo> = {},
): SyncAccountInfo {
  const limits =
    tier === "free"
      ? { maxBlobBytes: 50 * MB, maxAccountBlobBytes: GB, maxAccountEvents: 50_000, aiMonthlyCredits: 0 }
      : { maxBlobBytes: 200 * MB, maxAccountBlobBytes: 20 * GB, maxAccountEvents: null, aiMonthlyCredits: 2_000 };
  return {
    email: "reader@example.com",
    blobBytesUsed: 412 * MB,
    eventsUsed: 18_402,
    aiCreditsUsed: 0,
    tier,
    hasBilling: tier !== "free",
    limits,
    ...patch,
  };
}

function bookRow(
  bookId: string,
  title: string,
  patch: Partial<SyncBookBacklogRow> = {},
): SyncBookBacklogRow {
  return {
    bookId,
    title,
    byteSize: 18 * MB,
    pushState: "pending",
    lastError: null,
    localBytes: true,
    ...patch,
  };
}

/**
 * The connection object is only forwarded to the sign-in dialog here, so the
 * stories hand over an inert stand-in rather than a live scheduler.
 */
const inertSync = {
  status: idle,
  profile,
  connected: true,
  busy: false,
  sendLink: async () => null,
  connect: async () => {},
  disconnect: async () => {},
  requestSyncNow: async () => {},
} as unknown as ReturnType<typeof useSyncConnection>;

/**
 * The Sync group of Data & Sync — the app's most state-rich settings surface.
 *
 * Disconnected it is a single quiet row; connected it becomes the panel's row
 * grammar, one concern per row: who the account is, what sync is doing, which
 * plan pays for it, and which book files the relay still doesn't hold.
 *
 * Every one of those inputs comes from somewhere Storybook can't reach — the
 * scheduler singleton, the relay, Tauri IPC — so the container passes them in
 * and these stories write them out.
 */
const meta = {
  title: "Interface/Settings/SyncAccountGroup",
  component: SyncAccountGroupView,
  parameters: { layout: "padded" },
  args: {
    supported: true,
    connected: true,
    status: idle,
    profile,
    accountInfo: account("free"),
    backlog: null,
    bookBacklog: [],
    movingBookTitle: null,
    connectOpen: false,
    disconnectOpen: false,
    onConnectOpenChange: () => {},
    onDisconnectOpenChange: () => {},
    onSyncNow: () => {},
    onDisconnect: () => {},
    onOpenPortal: () => {},
    onOpenUpgrade: () => {},
    sync: inertSync,
  },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SyncAccountGroupView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Connected on the free plan, settled — the everyday state. */
export const ConnectedFree: Story = {};

/** Not connected yet: one row, one button, and the flow lives in the dialog. */
export const Disconnected: Story = {
  args: { connected: false, accountInfo: null, profile: null },
};

/** The web build, which has no store and no sync at all. */
export const Unsupported: Story = {
  args: { supported: false },
};

/** A paid plan with billing: the control manages the subscription in Stripe. */
export const PaidPlan: Story = {
  args: { accountInfo: account("pro") },
};

/**
 * A paid tier the operator granted, with no billing behind it. There is
 * nothing to manage, so no control is offered.
 */
export const GrantedPlanWithoutBilling: Story = {
  args: { accountInfo: account("pro", { hasBilling: false }) },
};

/** Staff plans are never sold, so staff sees no plan control whatsoever. */
export const StaffPlan: Story = {
  args: { accountInfo: account("staff", { hasBilling: false }) },
};

/** Offline: the relay never answered, so the plan row is quietly absent and
    the account falls back to its shortened opaque id. */
export const OfflineWithoutAccountInfo: Story = {
  args: { accountInfo: null },
};

/** A cycle running, with the book in flight named and part progress shown. */
export const Syncing: Story = {
  args: { status: uploadingBook, movingBookTitle: "Pale Fire", backlog },
};

/** Settled but with work still owed to the relay. */
export const PendingBacklog: Story = {
  args: { backlog },
};

/** Never synced on this device yet. */
export const NeverSynced: Story = {
  args: { status: snapshot({ lastSyncAt: null, lastCycle: null }) },
};

/** A failed cycle: the relay's message, in the warning tone. */
export const CycleFailed: Story = {
  args: { status: failed },
};

/**
 * The relay rejected the session. "Sync now" would be a guaranteed 401, so its
 * slot offers the re-login instead.
 */
export const SessionRejected: Story = {
  args: { status: unauthenticated },
};

/** Books whose files the relay doesn't hold yet, each with its reason. */
export const BookBacklog: Story = {
  args: {
    bookBacklog: [
      bookRow("b1", "Pale Fire"),
      bookRow("b2", "The Sea, The Sea", { pushState: "failed", lastError: "network timeout" }),
      bookRow("b3", "The Annals of the Former World", {
        byteSize: 340 * MB,
        pushState: "rejected",
        lastError: "blob exceeds 52428800 bytes",
      }),
      bookRow("b4", "Tractatus Logico-Philosophicus", { localBytes: false, byteSize: null }),
    ],
  },
};

/**
 * Over the account's storage limit: the usage figure turns, and the books that
 * the quota blocked say so above the list.
 */
export const OverStorageQuota: Story = {
  args: {
    accountInfo: account("free", { blobBytesUsed: Math.round(1.4 * GB) }),
    bookBacklog: [
      bookRow("b3", "The Annals of the Former World", {
        byteSize: 340 * MB,
        pushState: "rejected",
        lastError: "account blob quota exceeded",
      }),
    ],
  },
};

/**
 * A self-hosted relay predating tiers sends no limits — the usage line falls
 * back to a plain figure rather than "of undefined".
 */
export const RelayWithoutLimits: Story = {
  args: {
    accountInfo: account("free", {
      limits: {
        maxBlobBytes: null,
        maxAccountBlobBytes: null,
        maxAccountEvents: null,
        aiMonthlyCredits: null,
      },
    }),
  },
};

/** The disconnect confirmation. */
export const DisconnectConfirmation: Story = {
  args: { disconnectOpen: true },
};

/** The sign-in dialog, as the disconnected row opens it. */
export const ConnectDialogOpen: Story = {
  args: { connected: false, accountInfo: null, profile: null, connectOpen: true },
};

/** The same dialog reached from a rejected session, which is a re-login. */
export const ReloginDialogOpen: Story = {
  args: { status: unauthenticated, connectOpen: true },
};
