import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
import { seed, withAtoms } from "../../../story-support/atoms";
import type { InstalledPlugin } from "../../plugins/lib/plugin-types";
import { installedPluginsAtom } from "../../plugins/state/plugin-store";
import { PluginsPanel } from "./PluginsPanel";

function plugin(
  id: string,
  name: string,
  patch: Partial<InstalledPlugin> = {},
): InstalledPlugin {
  return {
    manifest: {
      id,
      name,
      version: "1.2.0",
      schemaVersion: 1,
      requires: {},
      author: "ReadAware",
      description: `${name} — a first-party plugin.`,
      permissions: ["service:network"],
    },
    enabled: true,
    ...patch,
  };
}

const installed: InstalledPlugin[] = [
  plugin("dictionary", "Dictionary", { builtin: true }),
  plugin("editorial-themes", "Editorial Themes", { builtin: true }),
  plugin("rss-reader", "RSS Reader", { enabled: false }),
  plugin("focus-timer", "Focus Timer"),
];

/**
 * Settings → Plugins: the Installed and Marketplace tabs, with the active
 * tab's primary action on the tab strip's trailing edge.
 *
 * Two things to know when reading these stories. Installing from a folder is a
 * desktop-only file dialog, so that action is inert here. And the tab strip
 * mounts both panels (the inactive one hidden), which means the Marketplace's
 * registry fetch fires on load exactly as it does in the app — its result is
 * whatever the network gives, so the marketplace's own states are covered
 * deterministically by `PluginMarketplaceView`'s stories instead.
 */
const meta = {
  title: "Interface/Settings/PluginsPanel",
  component: PluginsPanel,
  parameters: { layout: "fullscreen" },
  decorators: [withAtoms(seed(installedPluginsAtom, installed))],
} satisfies Meta<typeof PluginsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A mixed shelf: bundled plugins, an installed one, and one turned off. */
export const Installed: Story = {};

/** Nothing installed beyond the bundle — or nothing at all. */
export const NoPlugins: Story = {
  decorators: [withAtoms(seed(installedPluginsAtom, []))],
};

/** A plugin that failed to activate reports its error on the row. */
export const WithFailedPlugin: Story = {
  decorators: [
    withAtoms(
      seed(installedPluginsAtom, [
        ...installed,
        plugin("broken", "Broken Plugin", {
          enabled: true,
          error: "activate() threw: Cannot read properties of undefined",
        }),
      ]),
    ),
  ],
};

/** Filtering the installed list. */
export const Searching: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getAllByRole("searchbox")[0], "reader");
  },
};

/** A query that matches nothing installed. */
export const NoMatches: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getAllByRole("searchbox")[0], "zzzz");
  },
};

/** The uninstall confirmation, which a row arms in place. */
export const ConfirmingUninstall: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const buttons = canvas.getAllByRole("button", { name: /uninstall/i });
    if (buttons[0]) await userEvent.click(buttons[0]);
  },
};
