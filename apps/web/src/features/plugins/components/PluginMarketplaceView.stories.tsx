import type { Meta, StoryObj } from "@storybook/react-vite";
import type { InstalledPlugin } from "../lib/plugin-types";
import type { MarketplaceEntry } from "../runtime/marketplace";
import { PluginMarketplaceView } from "./PluginMarketplaceView";

const entries: MarketplaceEntry[] = [
  {
    id: "dictionary",
    name: "Dictionary",
    version: "1.4.0",
    author: "ReadAware",
    description: "Look up words while reading and keep a vocabulary notebook.",
    permissions: ["annotations:read", "annotations:write", "service:network"],
  },
  {
    id: "rss-reader",
    name: "RSS Reader",
    version: "0.9.2",
    author: "ReadAware",
    description: "Follow feeds and read new items in the app.",
    permissions: ["service:network", "library:write"],
  },
  {
    id: "focus-timer",
    name: "Focus Timer",
    version: "2.0.0",
    author: "kestrel",
    description: "A quiet pomodoro timer for reading sessions.",
  },
  {
    id: "editorial-themes",
    name: "Editorial Themes",
    version: "1.1.0",
    author: "ReadAware",
    description: "Extra app and reader themes in the editorial idiom.",
    permissions: ["ui:themes"],
  },
];

function installed(id: string, version: string, builtin = false): InstalledPlugin {
  const entry = entries.find((e) => e.id === id)!;
  return {
    manifest: { id: entry.id, name: entry.name, version, permissions: entry.permissions },
    enabled: true,
    builtin,
  };
}

/**
 * The marketplace list, in every state it can reach. The registry fetch and the
 * install call live in `PluginMarketplace` (the container), which is why these
 * stories can cover the error and installing states without touching the
 * network.
 */
const meta = {
  title: "Interface/Plugins/PluginMarketplaceView",
  component: PluginMarketplaceView,
  parameters: { layout: "padded" },
  args: {
    state: { status: "ready", entries },
    installed: [],
    busyId: null,
    query: "",
    desktop: true,
    onQueryChange: () => {},
    onRetry: () => {},
    onInstall: () => {},
  },
  decorators: [
    (Story) => (
      <div className="mx-auto max-w-2xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PluginMarketplaceView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The registry, nothing installed yet: every entry offers install. */
export const Ready: Story = {};

/** Fetching the registry. */
export const Loading: Story = {
  args: { state: { status: "loading" } },
};

/** The registry could not be reached; the message is the fetch's own. */
export const LoadError: Story = {
  args: {
    state: { status: "error", message: "Network request timed out after 8000ms" },
  },
};

/**
 * A mixed shelf: one up to date (label only), one with a newer version in the
 * registry (offers update), one bundled with the app (never installable).
 */
export const MixedInstallStates: Story = {
  args: {
    installed: [
      installed("dictionary", "1.4.0"),
      installed("rss-reader", "0.8.0"),
      installed("editorial-themes", "1.1.0", true),
    ],
  },
};

/** An install in flight: that row says so, and every other action is disabled. */
export const Installing: Story = {
  args: { busyId: "focus-timer" },
};

/** Off the desktop shell there is nowhere to install to, so the action is dead. */
export const NotDesktop: Story = {
  args: { desktop: false },
};

/** A query that matches part of the registry. */
export const Filtered: Story = {
  args: { query: "read" },
};

/** A query that matches nothing — distinct from an empty registry. */
export const NoMatches: Story = {
  args: { query: "zzzz" },
};

/** The registry itself is empty, which reads differently from "no matches". */
export const EmptyRegistry: Story = {
  args: { state: { status: "ready", entries: [] } },
};

/** An entry with neither description nor permissions still renders cleanly. */
export const MinimalEntry: Story = {
  args: {
    state: {
      status: "ready",
      entries: [{ id: "bare", name: "Bare plugin", version: "0.1.0" }],
    },
  },
};

/** A long description and a full permission set, for the row's worst case. */
export const LongEntry: Story = {
  args: {
    state: {
      status: "ready",
      entries: [
        {
          ...entries[0],
          description:
            "Looks up words while you read, keeps a vocabulary notebook, tracks review intervals, syncs entries across devices, and exports everything as Markdown or CSV whenever you ask it to.",
          permissions: [
            "annotations:read",
            "annotations:write",
            "library:read",
            "library:write",
            "service:network",
            "service:llm",
            "service:clipboard",
          ],
        },
      ],
    },
  },
};
