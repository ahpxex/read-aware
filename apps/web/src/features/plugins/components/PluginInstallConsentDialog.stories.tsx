import type { Meta, StoryObj } from "@storybook/react-vite";
import { PLUGIN_PERMISSIONS, type PluginManifest } from "../lib/plugin-types";
import { seed, withAtoms } from "../../../story-support/atoms";
import { pluginInstallConsentAtom } from "../state/plugin-store";
import { PluginInstallConsentDialog } from "./PluginInstallConsentDialog";

const manifest: PluginManifest = {
  id: "dictionary",
  name: "Dictionary",
  version: "1.4.0",
  schemaVersion: 1,
  requires: {},
  author: "ReadAware",
  description: "Look up words while reading and keep a vocabulary notebook.",
  permissions: ["annotations:read", "annotations:write", "service:network"],
};

/** Pairs a manifest with a resolver, as the install gate does. */
const consent = (next: PluginManifest) =>
  withAtoms(
    seed(pluginInstallConsentAtom, { manifest: next, resolve: () => {} }),
  );

/**
 * Installation is the trust boundary: this gate states who the plugin is, warns
 * that installing runs its code, and spells out every declared permission —
 * before a single file lands. It renders from a pending request on the consent
 * atom, so each story seeds one.
 */
const meta = {
  title: "Interface/Plugins/PluginInstallConsentDialog",
  component: PluginInstallConsentDialog,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof PluginInstallConsentDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A typical first-party plugin asking for three permissions. */
export const Default: Story = {
  decorators: [consent(manifest)],
};

/** A plugin that asks for nothing — the gate says so rather than showing a gap. */
export const NoPermissions: Story = {
  decorators: [consent({ ...manifest, permissions: [] })],
};

/** Every permission the contract defines, which is the worst case for length. */
export const EveryPermission: Story = {
  decorators: [consent({ ...manifest, permissions: [...PLUGIN_PERMISSIONS] })],
};

/** No author and no description: the identity line degrades to the version. */
export const MinimalManifest: Story = {
  decorators: [
    consent({
      id: "bare",
      name: "Bare plugin",
      version: "0.1.0",
      schemaVersion: 1,
      requires: {},
      permissions: ["service:network"],
    }),
  ],
};

/** A long name and description, to check the dialog's wrapping and cap. */
export const LongMetadata: Story = {
  decorators: [
    consent({
      ...manifest,
      name: "Comprehensive Vocabulary and Etymology Companion",
      author: "A rather long-winded plugin author name",
      description:
        "Looks up words while you read, keeps a vocabulary notebook, tracks review intervals, syncs entries across devices, and exports everything as Markdown or CSV whenever you ask it to.",
      permissions: [...PLUGIN_PERMISSIONS].slice(0, 8),
    }),
  ],
};

/** No pending request: the dialog stays closed. */
export const NoPendingRequest: Story = {
  decorators: [withAtoms(seed(pluginInstallConsentAtom, null))],
};
