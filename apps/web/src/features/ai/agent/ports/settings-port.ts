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
import {
  pluginFontsAtom,
  pluginThemesAtom,
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
