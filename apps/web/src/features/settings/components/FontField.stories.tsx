import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { seed, withAtoms } from "../../../story-support/atoms";
import { pluginFontsAtom } from "../../plugins/state/plugin-store";
import { CURATED_FONTS } from "../lib/curated-fonts";
import {
  toCuratedFont,
  toSystemFont,
  type ReaderFontFamily,
  type ReaderFontWeight,
} from "../lib/reader-settings";
import { FontField } from "./FontField";

/**
 * The component's props are a union (nullable selection or not), which
 * collapses to `never` if handed to `Meta<typeof FontField>` directly. The
 * stories therefore type themselves against one branch each.
 */
type FontFieldArgs = {
  value: ReaderFontFamily;
  onChange: (value: ReaderFontFamily) => void;
  fontWeight?: ReaderFontWeight;
  className?: string;
};

type NullableArgs = {
  value: ReaderFontFamily | null;
  onChange: (value: ReaderFontFamily | null) => void;
  defaultLabel: string;
  fontWeight?: ReaderFontWeight;
  className?: string;
};

const curated = toCuratedFont(CURATED_FONTS[0].id);

/**
 * The font selector shared by the reader's typography controls and the content
 * typography settings.
 *
 * It draws from three sources: the curated list (downloaded on demand — the
 * field owns that progress), fonts installed on the machine, and any faces a
 * plugin contributes. System fonts are enumerated over Tauri IPC, so in
 * Storybook that group is empty; the curated and plugin paths render fully.
 *
 * `defaultLabel` is what opts a caller into a null selection, meaning
 * "whatever this surface uses by default". The reader has no such state, so
 * its variant keeps null out of `onChange` entirely — both are storied here.
 */
const meta = {
  title: "Interface/Settings/FontField",
  component: FontField,
  parameters: { layout: "padded" },
  args: { value: curated, onChange: () => {} },
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<FontFieldArgs>;

export default meta;
type Story = StoryObj<typeof meta>;
type NullableStory = StoryObj<NullableArgs>;

/** A curated font selected — the reader's variant, which cannot be null. */
export const CuratedFont: Story = {};

/** The nullable variant, sitting on its default choice. */
export const WithDefaultOption: NullableStory = {
  render: (args) => <FontField {...args} />,
  args: { value: null, defaultLabel: "App default", onChange: () => {} },
};

/**
 * A system font. Outside the desktop shell the machine's fonts cannot be
 * enumerated, so a stored system font still names itself rather than
 * disappearing from the field.
 */
export const SystemFont: Story = {
  args: { value: toSystemFont("Iowan Old Style") },
};

/** A plugin-contributed face, with the plugin registered. */
export const PluginFont: Story = {
  args: { value: "plugin:editorial-themes:pt-serif" as ReaderFontFamily },
  decorators: [
    withAtoms(
      seed(pluginFontsAtom, [
        {
          key: "editorial-themes:pt-serif",
          pluginId: "editorial-themes",
          pluginName: "Editorial Themes",
          id: "pt-serif",
          label: "PT Serif",
          files: [],
        },
      ] as never),
    ),
  ],
};

/**
 * A stored value whose plugin is gone (disabled or uninstalled). The field
 * keeps it selectable rather than silently switching the reader's font.
 */
export const StalePluginFont: Story = {
  args: { value: "plugin:removed:some-face" as ReaderFontFamily },
  decorators: [withAtoms(seed(pluginFontsAtom, []))],
};

/** A heavier weight preset, which changes which curated weights get fetched. */
export const BoldWeightPreset: Story = {
  args: { fontWeight: "bold" },
};

/** Wired up, so switching fonts (and any curated download) can be watched. */
export const Interactive: Story = {
  render: function Interactive({ fontWeight, className }) {
    const [value, setValue] = useState<ReaderFontFamily>(curated);
    return (
      <>
        <FontField
          value={value}
          onChange={setValue}
          fontWeight={fontWeight}
          className={className}
        />
        <p className="mt-3 text-xs text-fg-subtle">
          selected: <code>{value}</code>
        </p>
      </>
    );
  },
};
