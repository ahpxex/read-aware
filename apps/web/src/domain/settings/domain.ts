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
import { createLogger } from "../../platform/logger";
import {
  aiPreferencesAtom,
  appSettingsAtom,
  generalSettingsAtom,
  shelfViewAtom,
  contentTypographyAtom,
  readerOverridesAtom,
  readerPreferencesAtom,
} from "../../state/ui";
import { menuConfigAtom } from "../../features/menus/state/menu-config";
import {
  agentVisiblePluginSettings,
  readPluginSettingsValues,
} from "../../features/plugins/lib/plugin-settings";
import {
  headerActionsAtom,
  installedPluginsAtom,
  pluginFontsAtom,
  pluginThemesAtom,
  selectionActionsAtom,
  textUnitReaderModeAtom,
} from "../../features/plugins/state/plugin-store";
import { getAIConfig } from "../../features/ai/lib/ai-config";
import { commitSettingsDraft } from "./persistence";
import { afterLocalKVWrites } from "../../platform/local-store";
import { getDefaultMarkColor } from "../../features/annotations/lib/annotation-prefs";
import { getUpdateChannel } from "../../features/update/lib/update-channel";
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
    shelf: store.get(shelfViewAtom),
    appearance: store.get(appSettingsAtom),
    reading: store.get(readerPreferencesAtom),
    readerOverrides: store.get(readerOverridesAtom),
    contentTypography: store.get(contentTypographyAtom),
    defaultMarkColor: getDefaultMarkColor(),
    updateChannel: getUpdateChannel(),
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

function settingsSnapshot(query?: SettingsQuery): SettingsSnapshot {
  return settingsSnapshotFromDraft(readDraft(), query);
}

function visibleSnapshot(
  policy: SettingsAccessPolicy,
  query?: SettingsQuery,
): SettingsSnapshot {
  return filterSnapshot(policy, settingsSnapshot(query));
}

function filterSnapshot(policy: SettingsAccessPolicy, snapshot: SettingsSnapshot): SettingsSnapshot {
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

async function applySettingsChanges(
  origin: EventOrigin,
  changes: SettingChange[],
): Promise<SettingsUpdateResult> {
  const before = readDraft();
  const result = applySettingChangesToDraft(before, changes);
  await commitSettingsDraft(before, result.draft);
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

// Read each patch from the settled predecessor, not from a failed optimistic
// record. Different actors share this order, including after rejected writes.
let updateTail: Promise<unknown> = Promise.resolve();
function enqueueSettingsChanges(origin: EventOrigin, changes: SettingChange[]): Promise<SettingsUpdateResult> {
  const accepted = structuredClone(changes);
  const result = updateTail.then(() => afterLocalKVWrites(() => applySettingsChanges(origin, accepted)));
  updateTail = result.then(() => {}, () => {});
  return result;
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
      snapshot: async (query) => {
        const accepted = query === undefined ? undefined : structuredClone(query);
        await updateTail;
        return afterLocalKVWrites(() => visibleSnapshot(policy, accepted));
      },
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
        const result = await enqueueSettingsChanges(origin, changes);
        return { ...result, settings: filterSnapshot(policy, result.settings) };
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
