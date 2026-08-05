import type {
  AgentSettingChange,
  AgentSettingsQuery,
  AgentSettingsUpdateResult,
  SettingsPort,
} from "@read-aware/agent";
import { getDefaultStore } from "jotai";
import { setLocale } from "../../../../i18n";
import {
  aiPreferencesAtom,
  appSettingsAtom,
  generalSettingsAtom,
  readerOverridesAtom,
  readerPreferencesAtom,
} from "../../../../state/ui";
import { menuConfigAtom } from "../../../menus/state/menu-config";
import {
  agentVisiblePluginSettings,
  readPluginSettingsValues,
  writePluginSettingsValues,
} from "../../../plugins/lib/plugin-settings";
import {
  headerActionsAtom,
  installedPluginsAtom,
  pluginFontsAtom,
  pluginThemesAtom,
  selectionActionsAtom,
  textUnitReaderModeAtom,
} from "../../../plugins/state/plugin-store";
import { getAIConfig, saveAIConfig } from "../../lib/ai-config";
import {
  applySettingChangesToDraft,
  settingsSnapshotFromDraft,
  type SettingsDraft,
} from "./settings-registry";

function readDraft(): SettingsDraft {
  const store = getDefaultStore();
  return {
    general: store.get(generalSettingsAtom),
    appearance: store.get(appSettingsAtom),
    reading: store.get(readerPreferencesAtom),
    readerOverrides: store.get(readerOverridesAtom),
    aiPreferences: store.get(aiPreferencesAtom),
    aiConfig: getAIConfig(),
    pluginThemes: store.get(pluginThemesAtom),
    pluginFonts: store.get(pluginFontsAtom),
    menus: {
      config: store.get(menuConfigAtom),
      plugins: {
        headerActions: store.get(headerActionsAtom),
        selectionActions: store.get(selectionActionsAtom),
        textUnitReaderMode: store.get(textUnitReaderModeAtom),
      },
    },
    pluginSettings: readPluginSettingsDraft(),
  };
}

function readPluginSettingsDraft(): SettingsDraft["pluginSettings"] {
  const declared = agentVisiblePluginSettings(
    getDefaultStore().get(installedPluginsAtom),
  );
  return {
    declared,
    values: Object.fromEntries(
      declared.map((plugin) => [
        plugin.pluginId,
        readPluginSettingsValues(plugin.pluginId),
      ]),
    ),
  };
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function commitDraft(before: SettingsDraft, next: SettingsDraft): void {
  const store = getDefaultStore();
  if (!equal(before.general, next.general)) {
    store.set(generalSettingsAtom, next.general);
    if (
      next.general.language &&
      next.general.language !== before.general.language
    ) {
      setLocale(next.general.language);
    }
  }
  if (!equal(before.appearance, next.appearance)) {
    store.set(appSettingsAtom, next.appearance);
  }
  if (!equal(before.reading, next.reading)) {
    store.set(readerPreferencesAtom, next.reading);
  }
  if (!equal(before.readerOverrides, next.readerOverrides)) {
    store.set(readerOverridesAtom, next.readerOverrides);
  }
  if (!equal(before.aiPreferences, next.aiPreferences)) {
    store.set(aiPreferencesAtom, next.aiPreferences);
  }
  if (!equal(before.aiConfig, next.aiConfig) && next.aiConfig) {
    saveAIConfig(next.aiConfig);
  }
  if (!equal(before.menus.config, next.menus.config)) {
    store.set(menuConfigAtom, next.menus.config);
  }
  for (const [pluginId, values] of Object.entries(next.pluginSettings.values)) {
    if (!equal(before.pluginSettings.values[pluginId], values)) {
      writePluginSettingsValues(pluginId, values);
    }
  }
}

function settingsSnapshot(query?: AgentSettingsQuery) {
  return settingsSnapshotFromDraft(readDraft(), query);
}

function applySettingsChanges(
  changes: AgentSettingChange[],
): AgentSettingsUpdateResult {
  const before = readDraft();
  const result = applySettingChangesToDraft(before, changes);
  commitDraft(before, result.draft);
  return {
    changed: result.changed,
    settings: settingsSnapshotFromDraft(result.draft),
  };
}

export function createSettingsPort(): SettingsPort {
  return {
    getSettings: async (query) => settingsSnapshot(query),
    updateSettings: async (changes) => applySettingsChanges(changes),
  };
}
