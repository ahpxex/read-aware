/**
 * The plugin lifecycle owner: enumerate installed folders, start each enabled
 * plugin in its sandbox, and keep the installed-plugins atom truthful.
 * Desktop-only — in a plain browser (dev/Storybook) every function is a no-op.
 * A broken plugin records its error and stays inert; it must never take the app
 * down.
 *
 * Plugin CODE runs in a Worker (plugin-sandbox.worker.ts), not here. This
 * module only decides what may start and holds the handle for tearing it down.
 */
import { getVersion } from "@tauri-apps/api/app";
import { getDefaultStore } from "jotai";
import { isTauri } from "../../../platform/environment";
import { localKV, replaceLocalKVPrefix } from "../../../platform/local-store";
import { createLogger } from "../../../platform/logger";
import { PluginManifestError, parseManifestJson, versionSatisfies } from "../lib/manifest";
import type {
  InstalledPlugin,
  PluginDisposable,
  PluginManifest,
} from "../lib/plugin-types";
import {
  forgetPluginEnabled,
  installedPluginsAtom,
  isPluginEnabled,
  markPluginsReady,
  persistPluginEnabled,
  registerFontContribution,
  registerThemeContribution,
  setInstalledPlugins,
  updateInstalledPlugin,
} from "../state/plugin-store";
import { contributionKey } from "../lib/plugin-types";
import { toPluginRef } from "../lib/plugin-theme";
import {
  commitPluginCandidate,
  discardPluginCandidate,
  listPluginEntries,
  pluginCandidateModuleUrl,
  pluginDocsClear,
  pluginDocsRestore,
  pluginDocsSnapshot,
  rollbackPluginFiles,
  stagePluginFiles,
  stagePluginFromDir,
  stagePluginFromZip,
  uninstallPluginFiles,
  type PluginCandidateDiskEntry,
  type PluginDocumentSnapshotRow,
  type PluginFilePayload,
} from "./plugin-backend";
import {
  startPluginWorker,
  type SandboxedPlugin,
  type StartPluginWorkerOptions,
} from "./plugin-worker-host";
import { onAppEvent } from "../../../platform/app-events";
import { unbindVirtualBook } from "../lib/virtual-books";
import { runPluginUpdateTransaction } from "./plugin-update-transaction";

const log = createLogger("plugins");

type ActivePlugin = {
  manifest: PluginManifest;
  sandbox: SandboxedPlugin;
  disposables: PluginDisposable[];
  candidateToken?: string;
};

const active = new Map<string, ActivePlugin>();
let appVersion = "0.0.0";
let initialized = false;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getInstalled(): InstalledPlugin[] {
  return getDefaultStore().get(installedPluginsAtom);
}

/** Boot entry — enumerate plugin folders and activate the enabled ones. */
export async function initializePlugins(): Promise<void> {
  if (!isTauri()) {
    // No plugin runtime in a plain browser — appearance fallbacks must not
    // keep waiting for contributions that will never register.
    markPluginsReady();
    return;
  }
  if (initialized) return;
  initialized = true;

  try {
    appVersion = await getVersion();
  } catch {
    // Advisory only — minAppVersion checks degrade to permissive.
  }

  let entries;
  try {
    entries = await listPluginEntries();
  } catch (error) {
    log.error("failed to enumerate installed plugins", error);
    // Nothing will register this session; unblock appearance fallbacks.
    markPluginsReady();
    return;
  }

  const installed: InstalledPlugin[] = [];
  for (const entry of entries) {
    try {
      const manifest = parseManifestJson(entry.manifest);
      if (manifest.id !== entry.id) {
        throw new PluginManifestError(
          `manifest.id "${manifest.id}" does not match folder name "${entry.id}"`,
        );
      }
      installed.push({
        manifest,
        enabled: isPluginEnabled(manifest.id, entry.builtin === true),
        builtin: entry.builtin === true,
      });
    } catch (error) {
      // Keep the broken folder visible in settings instead of hiding it.
      installed.push({
        manifest: { id: entry.id, name: entry.id, version: "0.0.0" },
        enabled: false,
        error: errorMessage(error),
      });
    }
  }
  setInstalledPlugins(installed);

  await Promise.all(
    installed
      .filter((plugin) => plugin.enabled && !plugin.error)
      .map((plugin) => activatePlugin(plugin.manifest)),
  );
  markPluginsReady();

  // Any deletion path (shelf UI included) must release the virtual-book
  // binding, or the registry leaks dead entries.
  onAppEvent("book-removed", ({ bookId }) => unbindVirtualBook(bookId));

  // Best-effort teardown on app quit — disposables run synchronously; async
  // deactivate() work races the process, which is the platform's nature.
  window.addEventListener("pagehide", () => {
    for (const id of [...active.keys()]) void deactivatePlugin(id);
  });
}

/**
 * Start one plugin inside its sandbox; failures are recorded on its settings
 * entry. The plugin's code never enters this realm — `startPluginWorker` runs
 * it in a Worker and brokers everything through its permission-gated context.
 */
async function activatePlugin(manifest: PluginManifest): Promise<void> {
  if (active.has(manifest.id)) return;
  try {
    active.set(manifest.id, await startPluginInstance(manifest));
    updateInstalledPlugin(manifest.id, { error: undefined });
  } catch (error) {
    log.error(`activation of "${manifest.id}" failed`, error);
    updateInstalledPlugin(manifest.id, { error: errorMessage(error) });
  }
}

function assertManifestCanActivate(manifest: PluginManifest): void {
  if (manifest.minAppVersion && !versionSatisfies(appVersion, manifest.minAppVersion)) {
    throw new Error(`requires app version ${manifest.minAppVersion} or newer`);
  }
  const installed = getInstalled().find((plugin) => plugin.manifest.id === manifest.id);
  if (manifest.permissions?.includes("reader:modes") && !installed?.builtin) {
    throw new Error("reader:modes is currently reserved for built-in plugins");
  }
}

/**
 * Construct one fully healthy runtime instance or leave no registrations
 * behind. This is also the primitive used by the update candidate path.
 */
async function startPluginInstance(
  manifest: PluginManifest,
  options: StartPluginWorkerOptions = {},
  candidateToken?: string,
): Promise<ActivePlugin> {
  assertManifestCanActivate(manifest);
  const disposables: PluginDisposable[] = [];
  let sandbox: SandboxedPlugin | undefined;
  try {
    sandbox = await startPluginWorker(manifest, appVersion, disposables, options);
    registerManifestContributions(manifest, disposables);
    await sandbox.checkHealth();
    return { manifest, sandbox, disposables, candidateToken };
  } catch (error) {
    for (const disposable of [...disposables].reverse()) {
      try {
        disposable.dispose();
      } catch (disposeError) {
        log.error(`activation rollback for "${manifest.id}" failed`, disposeError);
      }
    }
    await sandbox?.terminate().catch((terminateError) => {
      log.error(`activation sandbox rollback for "${manifest.id}" failed`, terminateError);
    });
    throw error;
  }
}

/**
 * Register the manifest's declarative contributions (validated by
 * `parseManifestJson`). A theme typography default naming the plugin's own
 * font (`plugin:<fontId>`) is expanded here to the full stored ref, so
 * everything downstream sees one ref shape.
 */
function registerManifestContributions(
  manifest: PluginManifest,
  disposables: PluginDisposable[],
): void {
  for (const font of manifest.fonts ?? []) {
    disposables.push(
      registerFontContribution({
        ...font,
        key: contributionKey(manifest.id, font.id),
        pluginId: manifest.id,
        pluginName: manifest.name,
      }),
    );
  }
  for (const theme of manifest.themes ?? []) {
    const typography = theme.reader?.typography;
    const fontFamily = typography?.fontFamily;
    const expanded =
      fontFamily && /^plugin:[a-z0-9][a-z0-9-]*$/.test(fontFamily)
        ? toPluginRef(manifest.id, fontFamily.slice("plugin:".length))
        : fontFamily;
    disposables.push(
      registerThemeContribution({
        ...theme,
        reader: theme.reader && {
          ...theme.reader,
          typography: typography && { ...typography, fontFamily: expanded },
        },
        key: contributionKey(manifest.id, theme.id),
        pluginId: manifest.id,
        pluginName: manifest.name,
      }),
    );
  }
}

/** Dispose every contribution, then tear the plugin's realm down. */
async function deactivatePlugin(id: string): Promise<void> {
  const entry = active.get(id);
  if (!entry) return;
  active.delete(id);
  await stopPluginInstance(entry);
}

async function stopPluginInstance(entry: ActivePlugin): Promise<void> {
  const id = entry.manifest.id;
  for (const disposable of [...entry.disposables].reverse()) {
    try {
      disposable.dispose();
    } catch (error) {
      log.error(`dispose from "${id}" failed`, error);
    }
  }
  try {
    await entry.sandbox.terminate();
  } catch (error) {
    log.error(`terminating "${id}" failed`, error);
  }
  if (entry.candidateToken) {
    await discardPluginCandidate(entry.candidateToken).catch((error) => {
      log.warn(`candidate cleanup for "${id}" failed`, error);
    });
  }
}

/** Settings toggle — persists, then (de)activates immediately, no restart. */
export async function setPluginEnabled(id: string, enabled: boolean): Promise<void> {
  persistPluginEnabled(id, enabled);
  updateInstalledPlugin(id, { enabled, error: undefined });
  if (enabled) {
    const plugin = getInstalled().find((entry) => entry.manifest.id === id);
    if (plugin) await activatePlugin(plugin.manifest);
  } else {
    await deactivatePlugin(id);
  }
}

function parseCandidate(entry: PluginCandidateDiskEntry): PluginManifest {
  const manifest = parseManifestJson(entry.manifest);
  if (manifest.id !== entry.id) {
    throw new PluginManifestError(
      `manifest.id "${manifest.id}" does not match folder name "${entry.id}"`,
    );
  }
  return manifest;
}

type PluginDataSnapshot = {
  kv: Record<string, string>;
  documents: PluginDocumentSnapshotRow[];
};

async function snapshotPluginData(id: string): Promise<PluginDataSnapshot> {
  return {
    kv: localKV.entries(`read-aware-plugin.${id}.`),
    documents: await pluginDocsSnapshot(id),
  };
}

async function restorePluginData(id: string, snapshot: PluginDataSnapshot): Promise<void> {
  const prefix = `read-aware-plugin.${id}.`;
  await Promise.all([
    replaceLocalKVPrefix(prefix, snapshot.kv),
    pluginDocsRestore(id, snapshot.documents),
  ]);
}

async function restartPreviousInstance(previous: ActivePlugin): Promise<void> {
  await stopPluginInstance(previous);
  const restored = await startPluginInstance(previous.manifest);
  active.set(previous.manifest.id, restored);
}

/**
 * Blue-green install/update: activate and probe the staged candidate while the
 * previous version still owns the durable on-disk slot. Only then commit the
 * candidate, switch runtime ownership, and retire the previous sandbox.
 */
async function applyCandidate(entry: PluginCandidateDiskEntry): Promise<InstalledPlugin> {
  let manifest: PluginManifest;
  try {
    manifest = parseCandidate(entry);
  } catch (error) {
    await discardPluginCandidate(entry.token).catch(() => {});
    throw error;
  }
  const existing = getInstalled().find((plugin) => plugin.manifest.id === manifest.id);

  if (existing?.builtin) {
    await discardPluginCandidate(entry.token).catch(() => {});
    throw new Error(`"${manifest.id}" is a built-in plugin and cannot be replaced`);
  }

  const previous = active.get(manifest.id);
  const dataSnapshot = await snapshotPluginData(manifest.id).catch(async (error) => {
    await discardPluginCandidate(entry.token).catch(() => {});
    throw error;
  });
  let accepted = false;
  let candidateRuntimeError: string | undefined;
  let committed: Awaited<ReturnType<typeof commitPluginCandidate>> | undefined;
  const plugin: InstalledPlugin = { manifest, enabled: true };

  await runPluginUpdateTransaction<ActivePlugin>({
    startCandidate: () =>
      startPluginInstance(
        manifest,
        {
          moduleUrl: pluginCandidateModuleUrl(entry.token, manifest.main ?? "main.js"),
          instanceId: `${manifest.id}@candidate:${entry.token}`,
          onRuntimeError: (message) => {
            if (accepted) updateInstalledPlugin(manifest.id, { error: message });
            else candidateRuntimeError = message;
          },
        },
        entry.token,
      ),
    verifyCandidate: () => {
      if (candidateRuntimeError) throw new Error(candidateRuntimeError);
    },
    commitFiles: async () => {
      committed = await commitPluginCandidate(entry.token);
    },
    verifyCommit: () => {
      if (!committed) throw new Error("plugin candidate was not committed");
      const committedManifest = parseManifestJson(committed.manifest);
      if (committed.id !== manifest.id || committedManifest.version !== manifest.version) {
        throw new Error("committed plugin candidate does not match the health-checked version");
      }
      if (candidateRuntimeError) throw new Error(candidateRuntimeError);
    },
    accept: (next) => {
      active.set(manifest.id, next);
      setInstalledPlugins([
        ...getInstalled().filter((installed) => installed.manifest.id !== manifest.id),
        plugin,
      ]);
      persistPluginEnabled(manifest.id, true);
      accepted = true;
    },
    retirePrevious: async () => {
      if (previous) await stopPluginInstance(previous);
    },
    cleanupCandidate: async (next) => {
      if (active.get(manifest.id) === next) active.delete(manifest.id);
      if (next) await stopPluginInstance(next);
      else await discardPluginCandidate(entry.token);
    },
    rollbackFiles: async () => {
      if (existing) await rollbackPluginFiles(manifest.id);
      else await uninstallPluginFiles(manifest.id);
    },
    restoreData: () => restorePluginData(manifest.id, dataSnapshot),
    restartPrevious: async () => {
      if (previous) await restartPreviousInstance(previous);
    },
  });

  return plugin;
}

export type PreparedPluginInstall = {
  manifest: PluginManifest;
  complete(): Promise<InstalledPlugin>;
  discard(): Promise<void>;
};

function preparedCandidate(entry: PluginCandidateDiskEntry): PreparedPluginInstall {
  const manifest = parseCandidate(entry);
  let consumed = false;
  return {
    manifest,
    async complete() {
      if (consumed) throw new Error("plugin candidate has already been consumed");
      consumed = true;
      return applyCandidate(entry);
    },
    async discard() {
      if (consumed) return;
      consumed = true;
      await discardPluginCandidate(entry.token);
    },
  };
}

async function prepareStagedCandidate(
  staged: Promise<PluginCandidateDiskEntry>,
): Promise<PreparedPluginInstall> {
  const entry = await staged;
  try {
    return preparedCandidate(entry);
  } catch (error) {
    await discardPluginCandidate(entry.token).catch(() => {});
    throw error;
  }
}

/** Stage a local folder before the consent gate; it is inert until complete. */
export async function preparePluginInstall(srcDir: string): Promise<PreparedPluginInstall> {
  return prepareStagedCandidate(stagePluginFromDir(srcDir));
}

/** Stage a zip before the consent gate; it is inert until complete. */
export async function preparePluginZipInstall(zipPath: string): Promise<PreparedPluginInstall> {
  return prepareStagedCandidate(stagePluginFromZip(zipPath));
}

/** Install (or replace) from fetched file contents (the marketplace path). */
export async function installPluginFiles(
  id: string,
  files: PluginFilePayload[],
): Promise<InstalledPlugin> {
  return applyCandidate(await stagePluginFiles(id, files));
}

/**
 * Remove the plugin's files. Its KV storage is deliberately kept (settings
 * survive a reinstall); its DOCUMENT collections are wiped — documents'
 * declared lifecycle is the plugin's own.
 */
export async function uninstallPlugin(id: string): Promise<void> {
  const target = getInstalled().find((entry) => entry.manifest.id === id);
  if (target?.builtin) throw new Error(`"${id}" is a built-in plugin`);
  await deactivatePlugin(id);
  await uninstallPluginFiles(id);
  await pluginDocsClear(id).catch((error) => {
    log.error(`document wipe for "${id}" failed`, error);
  });
  forgetPluginEnabled(id);
  setInstalledPlugins(getInstalled().filter((entry) => entry.manifest.id !== id));
}
