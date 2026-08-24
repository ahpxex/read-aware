import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { idle, unauthenticated } from "../../sync/components/sync.fixtures";
import type { useSyncConnection } from "../hooks/useSyncConnection";
import { SyncConnectDialog } from "./SyncConnectDialog";

/** A stand-in connection: the dialog only calls these, never a live relay. */
function connection(
  patch: Partial<ReturnType<typeof useSyncConnection>> = {},
): ReturnType<typeof useSyncConnection> {
  return {
    status: idle,
    profile: null,
    connected: false,
    busy: false,
    sendLink: async () => null,
    verifyToken: async () => {
      throw new Error("stories: verifyToken is not wired");
    },
    finishConnect: async () => {},
    disconnect: async () => {},
    requestSyncNow: async () => {},
    ...patch,
  } as unknown as ReturnType<typeof useSyncConnection>;
}

/**
 * The connect-account dialog: pick a sign-in door, then paste the one-time
 * token and set the E2E passphrase.
 *
 * Pulling the whole flow out of the settings page is what keeps Data & Sync a
 * list of quiet rows — and a stacked single-column dialog cannot overflow on a
 * narrow screen the way the old inline form did. Form state lives in the
 * dialog and deliberately survives the user leaving to fetch their token; it
 * resets only on a successful connect.
 */
const meta = {
  title: "Interface/Settings/SyncConnectDialog",
  component: SyncConnectDialog,
  parameters: { layout: "fullscreen" },
  args: { open: true, onClose: () => {}, sync: connection() },
} satisfies Meta<typeof SyncConnectDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The first step: choose a door — OAuth, or a magic link by email. */
export const SignInStep: Story = {};

/** An email typed, ready to request a link. */
export const EmailEntered: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.type(body.getAllByRole("textbox")[0], "reader@example.com");
  },
};

/** A request in flight: the controls disable until the relay answers. */
export const Busy: Story = {
  args: { sync: connection({ busy: true }) },
};

/** The identity gate: the account a token opened, in full, BEFORE the
 *  passphrase field appears — the login-CSRF defense in its visible form. */
export const ConfirmedIdentity: Story = {
  args: {
    sync: connection({
      verifyToken: async () => ({
        session: "sess_story",
        accountId: "acct_story",
        email: "attacker@example.com",
        keys: null,
      }),
    }),
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(body.getByRole("button", { name: /Google/ }));
    await userEvent.type(body.getByRole("textbox"), "story-sign-in-token");
    // Exact match: the OAuth buttons also start with "Continue".
    await userEvent.click(body.getByRole("button", { name: /^Continue$/ }));
  },
};

/**
 * Reached from a rejected session, where this same dialog is a re-login rather
 * than a first sign-in.
 */
export const Relogin: Story = {
  args: {
    sync: connection({
      status: unauthenticated,
      connected: true,
      profile: {
        syncEnabled: true,
        remoteAccountId: "acct_9f4c2b7ae1d0",
        encryptionKeyRef: "key_local",
        lastPushAt: null,
        lastPullAt: null,
      },
    }),
  },
};

/** Closed — the dialog renders nothing. */
export const Closed: Story = {
  args: { open: false },
};
