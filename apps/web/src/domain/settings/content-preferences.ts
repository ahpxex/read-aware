import { CONTENT_FONT_SIZES } from "../../features/settings/lib/content-typography";
import { MARK_COLORS } from "../../features/annotations/lib/annotation-prefs";
import type { SettingDefinition, SettingsDraft } from "./catalog";
import { cleanFontFamily, fontOptions } from "./font-options";

/** App content preferences are global; they never create per-book appearance overrides. */
export function contentPreferenceDefinitions(): SettingDefinition[] {
  const definitions: SettingDefinition[] = [
    {
      path: "appearance.contentTypography.followReader", section: "appearance", label: "Content follows reader typography", kind: "boolean",
      description: "Follow the global reader font and spacing, not the open book's override.",
      read: state => state.contentTypography.followReader,
      write: (state, value) => { state.contentTypography.followReader = value as boolean; },
    },
    {
      path: "appearance.contentTypography.fontFamily", section: "appearance", label: "Content font", kind: "string", nullable: true,
      description: "Used while followReader is false. Null selects the app sans font; it does not delete an override.",
      options: state => [{ value: null, label: "App font" }, ...fontOptions(state)],
      read: state => state.contentTypography.fontFamily,
      validate: (value, state) => cleanFontFamily(value, state, "appearance.contentTypography.fontFamily"),
      write: (state, value) => { state.contentTypography.fontFamily = value as SettingsDraft["contentTypography"]["fontFamily"]; },
    },
    ...([
      ["fontSize", "Content font size", CONTENT_FONT_SIZES],
      ["lineSpacing", "Content line spacing", ["compact", "comfortable", "relaxed"]],
    ] as const).map(([key, label, values]): SettingDefinition => ({
      path: `appearance.contentTypography.${key}`, section: "appearance", label, kind: "enum",
      description: "Used while appearance.contentTypography.followReader is false.",
      options: values.map(value => ({ value, label: value })),
      read: state => state.contentTypography[key],
      write: (state, value) => { state.contentTypography = { ...state.contentTypography, [key]: value }; },
    })),
    {
      path: "annotations.defaultColor", section: "annotations", label: "Default highlight color", kind: "enum",
      description: "Color for the next one-click highlight or underline; existing annotations are unchanged.",
      options: MARK_COLORS.map(value => ({ value, label: value })),
      read: state => state.defaultMarkColor,
      write: (state, value) => { state.defaultMarkColor = value as SettingsDraft["defaultMarkColor"]; },
    },
    {
      path: "general.updateChannel", section: "general", label: "Update channel", kind: "enum",
      description: "Device-local channel for the next update check. Does not check, download, install, restart, or roam to other devices.",
      options: ["stable", "beta"].map(value => ({ value, label: value })),
      read: state => state.updateChannel,
      write: (state, value) => { state.updateChannel = value as SettingsDraft["updateChannel"]; },
    },
  ];
  return definitions.map(definition => ({ ...definition, supportedTargets: ["global"] }));
}
