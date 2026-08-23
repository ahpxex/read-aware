import type {
  EventOrigin,
  SettingCatalogEntry,
  SettingChange,
  SettingReadResult,
  SettingValue,
  SettingsAccessPolicy,
  SettingsChangedEvent,
  SettingsQuery,
  SettingsQueryTarget,
  SettingsSnapshot,
  SettingsUpdateResult,
} from "@read-aware/core";
import { getDefaultStore } from "jotai";
import { setLocale } from "../../i18n";
import { createLogger } from "../../platform/logger";
import {
  aiPreferencesAtom,
  appSettingsAtom,
  generalSettingsAtom,
  readerOverridesAtom,
  readerPreferencesAtom,
} from "../../state/ui";
import { menuConfigAtom } from "../../features/menus/state/menu-config";
import {
  agentVisiblePluginSettings,
  readPluginSettingsValues,
  writePluginSettingsValues,
} from "../../features/plugins/lib/plugin-settings";
import {
  headerActionsAtom,
  installedPluginsAtom,
  pluginFontsAtom,
  pluginThemesAtom,
  selectionActionsAtom,
  textUnitReaderModeAtom,
} from "../../features/plugins/state/plugin-store";
import { getAIConfig, saveAIConfig } from "../../features/ai/lib/ai-config";
import {
  applySettingChangesToDraft,
  settingsSnapshotFromDraft,
  type SettingsDraft,
} from "./catalog-runtime";

const log = createLogger("settings-domain");
const listeners = new Set<(event: SettingsChangedEvent) => void>();

const FULL_ACCESS: SettingsAccessPolicy = {
  discover: ["*"],
  read: ["*"],
  write: ["*"],
};

function matchesPath(pattern: string, path: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) {
    return path.startsWith(pattern.slice(0, -1));
  }
  return pattern === path;
}

function canAccess(
  policy: SettingsAccessPolicy,
  operation: "discover" | "read" | "write",
  path: string,
): boolean {
  const patterns = [
    ...(policy[operation] ?? []),
    ...(operation === "discover" ? (policy.read ?? []) : []),
    ...(operation !== "write" ? (policy.write ?? []) : []),
  ];
  return patterns.some((pattern) => matchesPath(pattern, path));
}

function actorPolicy(
  origin: EventOrigin,
  policy: SettingsAccessPolicy | undefined,
): SettingsAccessPolicy {
  if (policy) return policy;
  return origin.startsWith("plugin:") ? {} : FULL_ACCESS;
}

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

function settingsSnapshot(query?: SettingsQuery): SettingsSnapshot {
  return settingsSnapshotFromDraft(readDraft(), query);
}

function visibleSnapshot(
  policy: SettingsAccessPolicy,
  query?: SettingsQuery,
): SettingsSnapshot {
  const snapshot = settingsSnapshot(query);
  return {
    ...snapshot,
    settings: snapshot.settings.filter((setting) =>
      canAccess(policy, "read", setting.path),
    ),
    overrides: snapshot.overrides
      .map((override) => ({
        ...override,
        paths: override.paths.filter((path) => canAccess(policy, "read", path)),
      }))
      .filter((override) => override.paths.length > 0),
  };
}

function applySettingsChanges(
  origin: EventOrigin,
  changes: SettingChange[],
): SettingsUpdateResult {
  const before = readDraft();
  const result = applySettingChangesToDraft(before, changes);
  commitDraft(before, result.draft);
  if (result.changed.length > 0) {
    const event: SettingsChangedEvent = {
      type: "settings.changed",
      origin,
      changes: result.changed,
    };
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (error) {
        log.error(`settings event handler from "${origin}" failed`, error);
      }
    }
  }
  return {
    changed: result.changed,
    settings: settingsSnapshotFromDraft(result.draft),
  };
}

export type SettingsDomain = {
  queries: {
    snapshot(query?: SettingsQuery): Promise<SettingsSnapshot>;
    discover(query?: SettingsQuery): Promise<SettingCatalogEntry[]>;
    read(path: string, target?: SettingsQueryTarget): Promise<SettingReadResult>;
  };
  commands: {
    update(changes: SettingChange[]): Promise<SettingsUpdateResult>;
  };
  events: {
    subscribe(handler: (event: SettingsChangedEvent) => void): () => void;
  };
};

export function createSettingsDomain(
  origin: EventOrigin,
  access?: SettingsAccessPolicy,
): SettingsDomain {
  const policy = actorPolicy(origin, access);
  return {
    queries: {
      snapshot: async (query) => visibleSnapshot(policy, query),
      discover: async (query) =>
        settingsSnapshot(query).settings
          .filter((setting) => canAccess(policy, "discover", setting.path))
          .map(({ value: _value, ...definition }) => definition),
      read: async (path, target) => {
        const normalizedPath = String(path);
        if (!canAccess(policy, "read", normalizedPath)) {
          throw new Error(`settings read is not permitted: ${normalizedPath}`);
        }
        const resolvedTarget = target ?? { kind: "global" as const };
        const descriptor = settingsSnapshot({ target: resolvedTarget }).settings.find(
          (setting) => setting.path === normalizedPath,
        );
        if (!descriptor) throw new Error(`unknown setting: ${normalizedPath}`);
        return {
          path: descriptor.path,
          value: descriptor.value as SettingValue,
          target: resolvedTarget,
        };
      },
    },
    commands: {
      update: async (changes) => {
        for (const change of changes) {
          if (!canAccess(policy, "write", change.path)) {
            throw new Error(`settings write is not permitted: ${change.path}`);
          }
        }
        return applySettingsChanges(origin, changes);
      },
    },
    events: {
      subscribe: (handler) => {
        const filtered = (event: SettingsChangedEvent) => {
          const changes = event.changes.filter((change) =>
            canAccess(policy, "read", change.path),
          );
          if (changes.length > 0) handler({ ...event, changes });
        };
        listeners.add(filtered);
        return () => listeners.delete(filtered);
      },
    },
  };
}
