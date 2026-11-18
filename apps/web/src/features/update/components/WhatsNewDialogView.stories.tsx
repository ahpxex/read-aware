import type { Meta, StoryObj } from "@storybook/react-vite";
import type { WhatsNewEntry } from "../lib/changelog-feed";
import { WhatsNewDialogView } from "./WhatsNewDialogView";

const entry: WhatsNewEntry = {
  version: "0.6.0",
  codename: "Cambria",
  date: "2026-09-20",
  text: {
    summary: "A more capable reading companion, reliable offline progress, and more ways to make ReadAware your own.",
    groups: [
      {
        kind: "new",
        items: [
          {
            title: "Reading insights for your assistant",
            body: "Your assistant can work with reading history and trends to help you reflect on what you have read.",
          },
          {
            title: "More capable plugins",
            body: "Plugins can work with your library, annotations and reading context through shared app capabilities.",
          },
        ],
      },
      {
        kind: "improved",
        items: [
          {
            title: "Backup and restore",
            body: "Review the contents of an encrypted backup and choose what to restore.",
          },
          { body: "Find the project and its community directly in About." },
        ],
      },
      {
        kind: "fixed",
        items: [
          {
            title: "Offline reading progress",
            body: "Reconnecting a device keeps the furthest reading position across devices.",
          },
        ],
      },
    ],
  },
};

/**
 * The post-upgrade notice.
 *
 * It exists as a dialog rather than a header chip because a one-time
 * announcement has no business competing with the primary navigation. The
 * release notes come from the same hand-written registry the website
 * changelog serves — and versions the site hasn't curated (pre-releases) fall
 * back to one line plus the external link.
 *
 * The version to announce and the fetch both live in the container, so these
 * stories cover the bodies without a network.
 */
const meta = {
  title: "Interface/Update/WhatsNewDialog",
  component: WhatsNewDialogView,
  parameters: { layout: "fullscreen" },
  args: {
    version: "0.6.0",
    codename: "Cambria",
    entry,
    loading: false,
    close: () => {},
  },
} satisfies Meta<typeof WhatsNewDialogView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A curated release: summary, then New / Improved / Fixed in that order. */
export const Curated: Story = {};

/** Enabled by default, with no separate search API key configured yet. */
export const SearchSetup: Story = {
  args: { configureSearch: () => {} },
};

/**
 * The dialog opens immediately and fills in when the notes land, so the
 * skeletons echo the filled layout's shape and the swap-in doesn't reflow.
 */
export const Loading: Story = {
  args: { entry: null, loading: true },
};

/**
 * A pre-release the site deliberately doesn't curate: one line plus the
 * changelog link, never an empty body.
 */
export const Uncurated: Story = {
  args: { version: "0.6.0-rc.1", codename: null, entry: null },
};

/**
 * Chinese-language readers are also offered the WeChat group, as a code to
 * scan beside the community text. The container passes the invitation only
 * while it works; without it the section is the text and the two links alone.
 */
export const WithWechatGroup: Story = {
  args: {
    wechatGroupUrl: "https://weixin.qq.com/g/storybook-sample-invitation-not-a-real-group-0000000000000000000000",
  },
};

/** A release with no codename — the version stands alone. */
export const WithoutCodename: Story = {
  args: { codename: null, entry: { ...entry, codename: null } },
};

/** Entries with no date recorded simply omit the timestamp. */
export const WithoutDate: Story = {
  args: { entry: { ...entry, date: "" } },
};

/** Only fixes this time; absent groups are skipped, not rendered empty. */
export const FixesOnly: Story = {
  args: {
    entry: {
      ...entry,
      text: {
        summary: "A maintenance release.",
        groups: [entry.text.groups[2]],
      },
    },
  },
};

/** Items without a run-in title are plain sentences. */
export const UntitledItems: Story = {
  args: {
    entry: {
      ...entry,
      text: {
        summary: "A quiet release.",
        groups: [
          {
            kind: "improved",
            items: [
              { body: "Faster shelf loading on large libraries." },
              { body: "Fewer redundant relay round-trips." },
            ],
          },
        ],
      },
    },
  },
};

/** A long release: the body scrolls inside its cap, header and footer fixed. */
export const LongRelease: Story = {
  args: {
    entry: {
      ...entry,
      text: {
        ...entry.text,
        groups: entry.text.groups.map((group) => ({
          ...group,
          items: Array.from({ length: 8 }, (_, i) => ({
            title: `Change number ${i + 1}`,
            body: "Described at about the length a real changelog entry runs to, which is a sentence or two.",
          })),
        })),
      },
    },
  },
};

/** Nothing to announce: the dialog renders nothing at all. */
export const NoVersion: Story = {
  args: { version: null },
};
