import type { Meta, StoryObj } from "@storybook/react-vite";
import type { WhatsNewEntry } from "../lib/changelog-feed";
import { WhatsNewDialogView } from "./WhatsNewDialogView";

const entry: WhatsNewEntry = {
  version: "0.6.0",
  codename: "Waxwing",
  date: "2026-06-28",
  text: {
    summary:
      "Sync learns to speak plainly, the reader gets a proper last page, and plugins can finally own a settings page.",
    groups: [
      {
        kind: "new",
        items: [
          {
            title: "The end of a book",
            body: "Reading past the last page now arrives somewhere — your marks, the time it took, and a way to ask the agent to look back on it.",
          },
          {
            title: "Plugin settings pages",
            body: "A plugin can declare a full settings page and the app renders it with the design system, no plugin-authored UI involved.",
          },
        ],
      },
      {
        kind: "improved",
        items: [
          { title: "Sync progress", body: "Percentages only when they're honest; the pull phase says so instead of inventing one." },
          { body: "The Data & Sync panel now speaks in rows rather than paragraphs." },
        ],
      },
      {
        kind: "fixed",
        items: [
          { title: "Ghost books", body: "Books that failed to upload no longer look synced on other devices." },
          { body: "PDF page turns no longer skip a page in double-page mode." },
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
    codename: "Waxwing",
    entry,
    loading: false,
    close: () => {},
  },
} satisfies Meta<typeof WhatsNewDialogView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A curated release: summary, then New / Improved / Fixed in that order. */
export const Curated: Story = {};

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
