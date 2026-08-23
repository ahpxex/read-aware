import type { Meta, StoryObj } from "@storybook/react-vite";
import type { PluginManifest } from "../../plugins/lib/plugin-types";
import { PluginSettingsSectionPanel } from "./PluginSettingsSectionPanel";

const manifest: PluginManifest = {
  id: "story-dictionary",
  name: "Dictionary",
  version: "1.4.0",
  author: "ReadAware",
  description: "Look up words while reading and keep a vocabulary notebook.",
  permissions: ["annotations:write", "service:network"],
  settings: [
    { kind: "toggle", id: "autoSave", label: "Save every lookup", description: "Adds each word you look up to the notebook.", value: true },
    { kind: "number", id: "perPage", label: "Entries per page", value: 25, min: 5, max: 100, step: 5 },
    {
      kind: "select",
      id: "source",
      label: "Definition source",
      value: "wiktionary",
      options: [
        { value: "wiktionary", label: "Wiktionary" },
        { value: "model", label: "Ask the model" },
      ],
    },
    {
      kind: "text",
      id: "endpoint",
      label: "Custom endpoint",
      placeholder: "https://…",
      helperText: "Leave empty to use the built-in source.",
      visibleWhen: { field: "source", equals: "wiktionary" },
    },
    { kind: "secret", id: "api_key", label: "API key", helperText: "Stored encrypted; never shown again." },
  ],
};

/**
 * One enabled plugin's declared settings, rendered inline as a first-class
 * settings section — the same form the Plugins panel shows in a dialog.
 *
 * The values live in the plugin's own storage, so these stories read and write
 * this Storybook origin's copy: editing a field here persists exactly as it
 * would in the app. The section rebuilds itself whenever that storage changes,
 * so an agent write or another surface reaches an open form instead of being
 * shadowed by a mount-time snapshot.
 */
const meta = {
  title: "Interface/Settings/PluginSettingsSectionPanel",
  component: PluginSettingsSectionPanel,
  parameters: { layout: "fullscreen" },
  args: { manifest },
} satisfies Meta<typeof PluginSettingsSectionPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A plugin with a full settings form, including a conditional field. */
export const Default: Story = {};

/** A single setting — the panel frame still carries the name and description. */
export const SingleSetting: Story = {
  args: {
    manifest: {
      ...manifest,
      id: "story-focus-timer",
      name: "Focus Timer",
      description: "A quiet pomodoro timer for reading sessions.",
      settings: [{ kind: "number", id: "minutes", label: "Session length", value: 25 }],
    },
  },
};

/** No description declared: the header collapses to the plugin's name. */
export const WithoutDescription: Story = {
  args: {
    manifest: { ...manifest, id: "story-bare", description: undefined },
  },
};

/**
 * A plugin that declares no settings at all. The section renders its frame and
 * nothing else — in the app it would not be offered in the first place.
 */
export const NoDeclaredSettings: Story = {
  args: { manifest: { ...manifest, id: "story-empty", settings: [] } },
};
