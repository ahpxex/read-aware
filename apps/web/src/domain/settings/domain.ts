import { READER_PREFERENCES_KEY } from "../../features/settings/lib/reader-settings";
import { copyEventCause, stampEventCause, actorOrigin, type DomainActor } from "../../platform/domain-actor";
import type {
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
  SettingsObservation,
  ReadingSettingsReset,
  SettingsOptionsQuery,
  SettingsOptionsPage,
} from "@read-aware/core";
import { AppError, validateSettingsOptionsQuery } from "@read-aware/core";
import { listSystemFonts } from "../../features/settings/lib/system-fonts";
import { listUserFonts } from "../fonts";
import { desktopStartup } from "../../platform/desktop-startup";
import { isFontSetting, systemFontOptions, userFontOptions } from "./font-options";
import { queryModelCatalog, refreshModelCatalog, modelCatalogRefreshConditions } from "./model-catalog";
import { DynamicOptionsCache } from "./dynamic-options";
import { pluginOptionSource } from "./plugin-option-source";
import { onAppEvent } from "../../platform/app-events";
import { readingResetPaths, resetReadingDraft } from "./reading-reset";
import { getDefaultStore } from "jotai";
import { createLogger } from "../../platform/logger";
import {
  aiPreferencesAtom,
  appSettingsAtom,
  generalSettingsAtom,
  shelfViewAtom,
  shortcutBindingsAtom,
  contentTypographyAtom,
  readerOverridesAtom,
  readerBookLanguagesAtom,
  readerPreferencesAtom,
  pageTurnSettingsAtom,
} from "../../state/ui";
import { menuConfigAtom } from "../../features/menus/state/menu-config";
import { agentVisiblePluginSettings, readPluginSettingsValues } from "../../features/plugins/lib/plugin-settings";
import {
  headerActionsAtom,
  installedPluginsAtom,
  pluginFontsAtom,
  pluginThemesAtom,
  selectionActionsAtom,
  textUnitReaderModeAtom,
} from "../../features/plugins/state/plugin-store";
import { getAIConfig } from "../../features/ai/lib/ai-config";
import { withPluginDataWrites } from "../../platform/plugin-data-access";
import { commitSettingsDraft, settingsDraftEntries } from "./persistence";
import { localKV } from "../../platform/local-store";
import { afterSettingsWrites, initializeSettingsObservation, settingsObservation } from "./observation-sources";
import { getDefaultMarkColor } from "../../features/annotations/lib/annotation-prefs";
import { getUpdateChannel } from "../../features/update/lib/update-channel";
import { shortcutEnvironmentAtom } from "../../features/settings/state/shortcut-state";
import { applySettingChangesToDraft, settingsSnapshotFromDraft, type SettingsDraft } from "./catalog-runtime";
import { settled } from "../../platform/write-settlement";

const log = createLogger("settings-domain");
const dynamicOptions = new DynamicOptionsCache((error) => log.warn("Dynamic setting options failed", error));
onAppEvent("plugin-storage-changed", ({ pluginId }) => dynamicOptions.invalidate(pluginId));
const listeners = new Set<(event: SettingsChangedEvent) => unknown>();

const FULL_ACCESS: SettingsAccessPolicy = {
  discover: ["*"],
  read: ["*"],
  write: ["*"],
};

/** `*` matches every path, `a.*` every path under `a.`, anything else itself. */
export function matchesSettingsPath(pattern: string, path: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) {
    return path.startsWith(pattern.slice(0, -1));
  }
  return pattern === path;
}

/** The patterns granting `operation`: write also grants read and discover, read also grants discover. */
export function settingsAccessPatterns(
  policy: SettingsAccessPolicy,
  operation: "discover" | "read" | "write",
): string[] {
  return [
    ...(policy[operation] ?? []),
    ...(operation === "discover" ? (policy.read ?? []) : []),
    ...(operation !== "write" ? (policy.write ?? []) : []),
  ];
}

function canAccess(policy: SettingsAccessPolicy, operation: "discover" | "read" | "write", path: string): boolean {
  return settingsAccessPatterns(policy, operation).some((pattern) => matchesSettingsPath(pattern, path));
}

function actorPolicy(origin: DomainActor, policy: SettingsAccessPolicy | undefined): SettingsAccessPolicy {
  if (policy) return policy;
  return actorOrigin(origin).startsWith("plugin:") ? {} : FULL_ACCESS;
}

function readDraft(): SettingsDraft {
  const store = getDefaultStore();
  return {
    general: store.get(generalSettingsAtom),
    shelf: store.get(shelfViewAtom),
    shortcuts: { bindings: store.get(shortcutBindingsAtom), ...store.get(shortcutEnvironmentAtom) },
    appearance: store.get(appSettingsAtom),
    reading: store.get(readerPreferencesAtom),
    readerOverrides: store.get(readerOverridesAtom),
    pageTurn: store.get(pageTurnSettingsAtom),
    bookLanguages: store.get(readerBookLanguagesAtom),
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
  const declared = agentVisiblePluginSettings(getDefaultStore().get(installedPluginsAtom));
  return {
    declared,
    values: Object.fromEntries(declared.map((plugin) => [plugin.pluginId, readPluginSettingsValues(plugin.pluginId)])),
  };
}

function settingsSnapshot(query?: SettingsQuery): SettingsSnapshot {
  return { ...settingsSnapshotFromDraft(readDraft(), query), revision: settingsObservation.revision };
}

async function visibleSnapshot(policy: SettingsAccessPolicy, query?: SettingsQuery): Promise<SettingsSnapshot> {
  const snapshot = filterSnapshot(policy, settingsSnapshot(query));
  const startup = snapshot.settings.find((setting) => setting.path === "general.launchAtStartup");
  if (startup) startup.value = desktopStartup.supported() ? await desktopStartup.read() : false;
  return snapshot;
}

function filterSnapshot(policy: SettingsAccessPolicy, snapshot: SettingsSnapshot): SettingsSnapshot {
  return {
    ...snapshot,
    settings: snapshot.settings
      .filter((setting) => canAccess(policy, "read", setting.path))
      .map((setting) => ({
        ...setting,
        writable:
          setting.writable &&
          canAccess(policy, "write", setting.path) &&
          (setting.path !== "general.launchAtStartup" || desktopStartup.supported()),
        ...(setting.shortcut
          ? {
              shortcut: {
                ...setting.shortcut,
                conflicts: setting.shortcut.conflicts.filter((path) => canAccess(policy, "read", path)),
              },
            }
          : {}),
      })),
    overrides: snapshot.overrides
      .map((override) => ({
        ...override,
        paths: override.paths.filter((path) => canAccess(policy, "read", path)),
      }))
      .filter((override) => override.paths.length > 0),
  };
}

async function applySettingsChanges(
  origin: DomainActor,
  changes: SettingChange[],
  policy: SettingsAccessPolicy,
  signal?: AbortSignal,
): Promise<SettingsUpdateResult> {
  const before = readDraft();
  // An old inert preference or a change in OS Settings must not be replayed by
  // a language/start-view patch. Resolve the system field before validation.
  const touchesGeneral = changes.some((change) => change.path.startsWith("general."));
  const storedGeneral = before.general;
  if (touchesGeneral || canAccess(policy, "read", "general.launchAtStartup")) {
    before.general = {
      ...before.general,
      launchAtStartup: desktopStartup.supported() ? await desktopStartup.read() : false,
    };
  }
  if (changes.some((change) => change.path === "general.launchAtStartup") && !desktopStartup.supported()) {
    throw new AppError("ui/unavailable", "Startup registration requires desktop");
  }
  signal?.throwIfAborted();
  const result = applySettingChangesToDraft(before, changes);
  if (touchesGeneral) before.general = storedGeneral;
  return commitResult(origin, before, result);
}

async function commitResult(
  origin: DomainActor,
  before: SettingsDraft,
  result: { draft: SettingsDraft; changed: SettingChange[] },
  query?: SettingsQuery,
): Promise<SettingsUpdateResult> {
  await commitSettingsDraft(
    before,
    result.draft,
    origin,
    result.changed.some((change) => change.path === "general.launchAtStartup"),
  );
  publishSettingsChanges(origin, result.changed);
  return {
    changed: result.changed,
    settings: { ...settingsSnapshotFromDraft(result.draft, query), revision: settingsObservation.revision },
  };
}

export function publishSettingsChanges(origin: DomainActor, changed: SettingChange[]): void {
  if (changed.length > 0) {
    const event: SettingsChangedEvent = stampEventCause(
      {
        type: "settings.changed",
        origin: actorOrigin(origin),
        changes: changed,
      },
      origin,
    );
    for (const listener of [...listeners]) {
      try {
        const result = listener(event);
        if (result && typeof (result as PromiseLike<unknown>).then === "function") {
          void Promise.resolve(result).catch((error) => log.error("Settings event callback failed", error));
        }
      } catch (error) {
        log.error(`settings event handler from "${event.origin}" failed`, error);
      }
    }
  }
}

// Read each patch from the settled predecessor, not from a failed optimistic
// record. Different actors share this order, including after rejected writes.
let updateTail: Promise<unknown> = Promise.resolve();
function enqueueSettingsChanges(
  origin: DomainActor,
  changes: SettingChange[],
  policy: SettingsAccessPolicy,
  signal?: AbortSignal,
): Promise<SettingsUpdateResult> {
  const accepted = structuredClone(changes);
  const pluginIds = accepted.flatMap((change) => /^plugins\.([a-z0-9-]+)\./.exec(change.path)?.[1] ?? []);
  const previous = updateTail;
  const result = withPluginDataWrites(pluginIds, () =>
    previous.then(() =>
      afterSettingsWrites(() => {
        signal?.throwIfAborted();
        return applySettingsChanges(origin, accepted, policy, signal);
      }),
    ),
  );
  // A rejected admission must not sever the ordering of an earlier command.
  updateTail = Promise.allSettled([previous, result]);
  return result;
}

export type SettingsDomain = {
  queries: {
    modelCatalogRefreshConditions(provider: string): import("@read-aware/core").OperationCondition[];
    modelCatalog(
      query: import("@read-aware/core").ModelCatalogQuery,
    ): Promise<import("@read-aware/core").ModelCatalogPage>;
    snapshot(query?: SettingsQuery): Promise<SettingsSnapshot>;
    observe(query: SettingsQuery, handler: (observation: SettingsObservation) => unknown): () => void;
    discover(query?: SettingsQuery): Promise<SettingCatalogEntry[]>;
    options(query: SettingsOptionsQuery, signal?: AbortSignal): Promise<SettingsOptionsPage>;
    read(path: string, target?: SettingsQueryTarget): Promise<SettingReadResult>;
  };
  commands: {
    refreshModelCatalog(provider: string, signal?: AbortSignal): Promise<import("@read-aware/core").ModelCatalogPage>;
    update(changes: SettingChange[], signal?: AbortSignal): Promise<SettingsUpdateResult>;
    resetReading(request: ReadingSettingsReset, signal?: AbortSignal): Promise<SettingsUpdateResult>;
  };
  events: {
    subscribe(handler: (event: SettingsChangedEvent) => unknown): () => void;
  };
};

export function createSettingsDomain(
  origin: DomainActor,
  access?: SettingsAccessPolicy,
  networkAllowed = !actorOrigin(origin).startsWith("plugin:"),
): SettingsDomain {
  initializeSettingsObservation();
  const policy = actorPolicy(origin, access);
  const authorizeCatalog = () => {
    if (
      !["ai.connection.primaryModel", "ai.connection.fastModel"].some((path) => canAccess(policy, "discover", path))
    ) {
      throw new AppError("settings/options-forbidden", "Model option discovery is not granted");
    }
  };
  const settledSnapshot = async (query?: SettingsQuery) => {
    const accepted = query === undefined ? undefined : structuredClone(query);
    await updateTail;
    return afterSettingsWrites(() => visibleSnapshot(policy, accepted));
  };
  return {
    queries: {
      modelCatalogRefreshConditions: (provider) => {
        try {
          authorizeCatalog();
        } catch {
          return [
            {
              kind: "permission",
              state: "unavailable",
              reason: "catalog-discovery-required",
              errorCode: "settings/options-forbidden",
            },
          ];
        }
        if (!networkAllowed)
          return [
            {
              kind: "permission",
              state: "unavailable",
              reason: "service:network-required",
              errorCode: "settings/options-forbidden",
            },
          ];
        return [
          { kind: "permission", state: "satisfied", reason: "authorized" },
          ...modelCatalogRefreshConditions(provider),
        ];
      },
      modelCatalog: async (query) => {
        authorizeCatalog();
        return queryModelCatalog(query);
      },
      snapshot: settledSnapshot,
      observe: (query, handler) => {
        const accepted = structuredClone(query);
        return settingsObservation.observe(() => settledSnapshot(accepted), handler, origin);
      },
      discover: async (query) => {
        const accepted = query === undefined ? undefined : structuredClone(query);
        await updateTail;
        const snapshot = await afterSettingsWrites(() => settingsSnapshot(accepted));
        return snapshot.settings
          .filter((setting) => canAccess(policy, "discover", setting.path))
          .map(({ value: _value, shortcut: _shortcut, reading: _reading, ...definition }) => ({
            ...definition,
            writable:
              definition.writable &&
              canAccess(policy, "write", definition.path) &&
              (definition.path !== "general.launchAtStartup" || desktopStartup.supported()),
          }));
      },
      options: async (query, signal) => {
        signal?.throwIfAborted();
        const accepted = validateSettingsOptionsQuery(structuredClone(query));
        if (!canAccess(policy, "discover", accepted.path)) {
          throw new AppError("settings/options-forbidden", "Setting option discovery is not granted");
        }
        const system = isFontSetting(accepted.path) ? systemFontOptions(await listSystemFonts()) : [];
        // Imported font files are catalog-like options too (the registry is
        // device-shared, not per-setting); they ride the same dynamic seam.
        const imported = isFontSetting(accepted.path) ? userFontOptions(await listUserFonts()) : [];
        await updateTail;
        const snapshot = await afterSettingsWrites(() => settingsSnapshot({ target: accepted.target }));
        signal?.throwIfAborted();
        const setting = snapshot.settings.find((entry) => entry.path === accepted.path);
        if (!setting) throw new AppError("settings/options-invalid", "Setting is unavailable for this target");
        if (setting.dynamicOptions)
          return dynamicOptions.query(accepted, pluginOptionSource(accepted.path, networkAllowed), signal);
        return dynamicOptions.staticPage(
          [...(setting.options ?? []), ...imported, ...system],
          snapshot.revision,
          accepted,
        );
      },
      read: async (path, target) => {
        const normalizedPath = String(path);
        if (!canAccess(policy, "read", normalizedPath)) {
          throw new AppError("settings/forbidden", `settings read is not permitted: ${normalizedPath}`);
        }
        const resolvedTarget = target ?? { kind: "global" as const };
        await updateTail;
        const descriptor = (
          await afterSettingsWrites(() => visibleSnapshot({ read: [normalizedPath] }, { target: resolvedTarget }))
        ).settings.find((setting) => setting.path === normalizedPath);
        if (!descriptor) throw new Error(`unknown setting: ${normalizedPath}`);
        return {
          path: descriptor.path,
          value: descriptor.value as SettingValue,
          target: resolvedTarget,
          ...(descriptor.reading ? { reading: descriptor.reading } : {}),
        };
      },
    },
    commands: {
      refreshModelCatalog: (provider, signal) => {
        authorizeCatalog();
        if (!networkAllowed)
          throw new AppError("settings/options-forbidden", "Model catalog refresh requires network authorization");
        return refreshModelCatalog(provider, signal);
      },
      resetReading: async (request, signal) => {
        const accepted = structuredClone(request);
        const result = updateTail.then(() =>
          afterSettingsWrites(async () => {
            signal?.throwIfAborted();
            const before = readDraft();
            if (readingResetPaths(before).some((path) => !canAccess(policy, "write", path))) {
              throw new AppError("memory/forbidden", "Reset requires write access to every reader preference");
            }
            const result = resetReadingDraft(before, accepted);
            return commitResult(origin, before, result, {
              section: "reading",
              target:
                accepted.target.kind === "book"
                  ? { kind: "book", bookId: accepted.target.bookId.trim() }
                  : { kind: "global" },
            });
          }),
        );
        updateTail = settled(result);
        const committed = await result;
        return { ...committed, settings: filterSnapshot(policy, committed.settings) };
      },
      update: async (changes, signal) => {
        signal?.throwIfAborted();
        for (const change of changes) {
          if (!canAccess(policy, "write", change.path)) {
            throw new AppError("settings/forbidden", `settings write is not permitted: ${change.path}`);
          }
        }
        const result = await enqueueSettingsChanges(origin, changes, policy, signal);
        return { ...result, settings: filterSnapshot(policy, result.settings) };
      },
    },
    events: {
      subscribe: (handler) => {
        const filtered = (event: SettingsChangedEvent) => {
          const changes = event.changes.filter((change) => canAccess(policy, "read", change.path));
          if (changes.length > 0) return handler(copyEventCause(event, { ...event, changes }));
        };
        listeners.add(filtered);
        return () => listeners.delete(filtered);
      },
    },
  };
}

/** Host-only planning. The returned KV bytes never enter the public capability. */
export async function prepareAtomicSettings(
  origin: DomainActor,
  changes: SettingChange[],
  access?: SettingsAccessPolicy,
) {
  initializeSettingsObservation();
  const accepted = structuredClone(changes);
  const policy = actorPolicy(origin, access);
  for (const change of accepted) {
    if (!canAccess(policy, "write", change.path)) throw new AppError("settings/forbidden", "Setting is not writable");
    if (["general.launchAtStartup", "general.fileAssociations"].includes(change.path)) {
      throw new AppError("transaction/invalid-operation", "System side effects cannot join an atomic transaction");
    }
  }
  await updateTail;
  return afterSettingsWrites(() => {
    const before = readDraft();
    const result = applySettingChangesToDraft(before, accepted);
    const entries = settingsDraftEntries(before, result.draft);
    const beforeValues = result.changed.flatMap((change) => {
      const targets =
        change.target?.kind === "all-books"
          ? [
              { kind: "global" as const },
              ...Object.keys(before.readerOverrides).map((bookId) => ({ kind: "book" as const, bookId })),
            ]
          : [change.target ?? { kind: "global" as const }];
      return targets.map((target) => {
        const descriptor = settingsSnapshotFromDraft(before, { target }).settings.find(
          (item) => item.path === change.path,
        );
        if (!descriptor) throw new AppError("transaction/invalid-operation", "Setting cannot be restored");
        return { path: change.path, target, value: descriptor.value } as SettingChange;
      });
    });
    // A book override can later be removed by undo. Retain the inherited
    // baseline as a read-only native condition, so its event/preview value stays true.
    const readingBaseline = result.changed.some(
      (change) =>
        (change.target?.kind === "book" || change.target?.kind === "all-books") && change.path.startsWith("reading."),
    )
      ? [
          {
            key: READER_PREFERENCES_KEY,
            expected: localKV.getItem(READER_PREFERENCES_KEY),
            value: localKV.getItem(READER_PREFERENCES_KEY),
          },
        ]
      : [];
    return {
      changed: result.changed,
      beforeValues,
      readingBaseline,
      revision: settingsObservation.revision,
      entries: [...entries].map(([key, value]) => ({ key, expected: localKV.getItem(key), value })),
    };
  });
}

export function assertAtomicSettingsRevision(revision: number): void {
  if (settingsObservation.revision !== revision)
    throw new AppError("transaction/conflict", "Settings or their providers changed before dispatch");
}
