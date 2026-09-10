/**
 * Builds the `ctx` handed to a plugin's activate(). This is a POLICY shell:
 * the data surface itself is the shared domain layer (src/domain), built
 * here with origin `plugin:<id>`; this module adds what is plugin-specific —
 * manifest permission gating (docs/plugin-system.md §4), contribution
 * branding and disposal tracking, virtual-book bindings, and the service
 * capabilities. Gating is API-level — it prevents accidental overreach, not
 * malice; the trust boundary is installation itself (§2). Within a domain,
 * write implies read.
 */
import { fetch as corsFreeFetch } from "@tauri-apps/plugin-http";
import type { PluginActionRegistration } from "@read-aware/plugin-types";
import { readerPanels } from "../../../services/reader-panels";
import { workspace } from "../../../services/workspace";
import { actorHostCommands } from "../../../services/host-command-runtime";
import { publishPluginView } from "../lib/plugin-view-channels";
import {
  AppError,
  canUseContribution,
  canUseHostService,
  domainGrantsFromPermissions,
  type DomainEventType,
  type SettingsAccessPolicy,
} from "@read-aware/core";
import { DEFAULT_LOCALE, i18n, isAppLocale } from "../../../i18n";
import { onAppEvent } from "../../../platform/app-events";
import { hostIO } from "../../../services/host-io";
import { pluginDirectory } from "../../../services/plugin-directory";
import { flushLocalKV, localKV } from "../../../platform/local-store";
import { createLogger } from "../../../platform/logger";
import { hostEnvironment } from "../../../platform/host-environment";
import { hostSync } from "../../../services/sync";
import { hostMaintenance } from "../../../services/maintenance";
import { createResourceOwner } from "../../../services/resources";
import { importResourceBook } from "../../../domain/library-resource-import";
import { inspectResourceBook } from "../../../domain/book-inspection";
import {
  deletePluginSecret,
  getPluginSecret,
  setPluginSecret,
} from "../../../platform/secret-store";
import {
  createActorDomainView,
  createSettingsDomain,
  type DomainEventSubscribe,
} from "../../../domain";
import { getAgentRuntime } from "../../ai/agent/agent-runtime";
import { AiNotConfiguredError } from "../../ai/lib/ai-errors";
import {
  bindVirtualBook,
  findVirtualBookId,
  removeOwnedVirtualBook,
  unbindVirtualBook,
} from "../lib/virtual-books";
import { showPluginToast } from "../lib/plugin-toast";
import { normalizeReaderMode } from "../lib/reader-mode";
import { pluginSchedules, registerPluginSchedule } from "./plugin-scheduler";
import { resolvePluginCapabilities } from "./plugin-capabilities";
import {
  contributionKey,
  type PluginContext,
  type PluginDisposable,
  type PluginManifest,
} from "../lib/plugin-types";
import { registerSyncTransport } from "../../../platform/sync/transport-registry";
import { releasePluginCallbacks } from "./plugin-callback-wire";
import {
  pluginDocsDelete,
  pluginDocsGet,
  pluginDocsList,
  pluginDocsPut,
  type PluginDocumentRow,
} from "./plugin-backend";
import {
  registerCommandContribution,
  registerAgentContextProviderContribution,
  registerAgentRetrievalProviderContribution,
  registerContentProviderContribution,
  registerHeaderActionContribution,
  registerReaderModeContribution,
  registerSelectionActionContribution,
  registerSettingsOptionsContribution,
  registerToolContribution,
  registerMemoryCandidateProviderContribution,
  registerVoiceProviderContribution,
  updateVoiceProviderVoices,
} from "../state/plugin-store";
import { PluginLifecycleController } from "./plugin-lifecycle";

const log = createLogger("plugins");

function toPluginDocument(row: PluginDocumentRow) {
  let data: unknown = null;
  try {
    data = JSON.parse(row.json);
  } catch {
    data = null;
  }
  return {
    id: row.id,
    data,
    bookId: row.bookId ?? undefined,
    anchor: row.anchor ?? undefined,
    updatedAt: row.updatedAt,
  };
}

/** Names for collections and secret keys: short, flat, no surprises. */
const NAMESPACE_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** The app UI's current locale, normalized to a supported one. */
export function currentAppLocale(): string {
  return i18n.language && isAppLocale(i18n.language) ? i18n.language : DEFAULT_LOCALE;
}

function requireSecretKey(key: string): void {
  if (!NAMESPACE_KEY.test(String(key))) {
    throw new Error(`invalid secret key: ${String(key)}`);
  }
}

/** Sanitize a command's declared default shortcut; junk shapes become none. */
function normalizeDefaultShortcut(
  raw: unknown,
): { key: string; mod?: boolean; alt?: boolean; shift?: boolean } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const candidate = raw as { key?: unknown; mod?: unknown; alt?: unknown; shift?: unknown };
  if (typeof candidate.key !== "string" || !candidate.key.trim()) return undefined;
  const key = candidate.key.length === 1 ? candidate.key.toLowerCase() : candidate.key;
  return {
    key,
    mod: candidate.mod === true || undefined,
    alt: candidate.alt === true || undefined,
    shift: candidate.shift === true || undefined,
  };
}

/**
 * KV namespace for a plugin. Exported so the sandbox host can ship the whole
 * namespace into the Worker at boot, keeping `storage.get()` synchronous there.
 */
export const pluginStoragePrefix = (pluginId: string) => `read-aware-plugin.${pluginId}.`;

export type PluginContextRuntime = {
  context: PluginContext;
  lifecycle: PluginLifecycleController;
};

function guardMutationTree<T extends object>(
  value: T,
  assertActive: (operation: string) => void,
  path: string,
): T {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      const operation = `${path}.${key}`;
      if (typeof entry === "function") {
        return [
          key,
          (...args: unknown[]) => {
            assertActive(operation);
            return entry(...args);
          },
        ];
      }
      if (entry && typeof entry === "object") {
        return [key, guardMutationTree(entry, assertActive, operation)];
      }
      return [key, entry];
    }),
  ) as T;
}

export function buildPluginContext(
  manifest: PluginManifest,
  appVersion: string,
  disposables: PluginDisposable[],
): PluginContextRuntime {
  const permissions = new Set(manifest.permissions ?? []);
  const selfOrigin = `plugin:${manifest.id}` as const;
  const lifecycle = new PluginLifecycleController(disposables);
  const resources = createResourceOwner(() => {
    if (!permissions.has("library:read") && !permissions.has("library:write")) throw new AppError("memory/forbidden", "Book resources require library access");
  });
  lifecycle.signal.addEventListener("abort", () => lifecycle.trackCleanup(resources.dispose()), { once: true });
  const domain = createActorDomainView(
    selfOrigin,
    domainGrantsFromPermissions(manifest.permissions ?? []),
    lifecycle.signal,
    work => lifecycle.trackCleanup(work),
  );
  const ownSettingsPaths = (manifest.settings ?? [])
    .filter(
      (field) =>
        field.kind !== "secret" &&
        !(field.kind === "text" && field.inputMode === "password"),
    )
    .map((field) => `plugins.${manifest.id}.${field.id}`);
  const requestedSettings = manifest.settingsAccess ?? {};
  const settingsAccess: SettingsAccessPolicy = {
    discover: [...(requestedSettings.discover ?? []), ...ownSettingsPaths],
    read: [...(requestedSettings.read ?? []), ...ownSettingsPaths],
    write: [...(requestedSettings.write ?? []), ...ownSettingsPaths],
  };
  const settingsDomain = createSettingsDomain(selfOrigin, settingsAccess);
  const storagePrefix = pluginStoragePrefix(manifest.id);
  const track = (factory: () => PluginDisposable): PluginDisposable =>
    lifecycle.stage(factory);
  const trackAction = (factory: () => PluginActionRegistration): PluginActionRegistration => {
    let live: PluginActionRegistration | undefined;
    const staged = track(() => { live = factory(); return live; });
    return { dispose: () => staged.dispose(), updateState: async state => {
      lifecycle.assertActive("contribution.updateState");
      return live ? live.updateState(state) : { status: "inactive" };
    } };
  };
  const brand = { pluginId: manifest.id, pluginName: manifest.name };

  /**
   * Domain `on` returns a bare unsubscribe; plugins get a tracked disposable,
   * plus the `ignoreSelf` option that mutes this plugin's own write echoes.
   */
  const trackedOn = <E extends DomainEventType>(on: DomainEventSubscribe<E>) =>
    ((
      event: never,
      handler: (broadcast: { origin?: string }) => void,
      options?: { ignoreSelf?: boolean },
    ) => {
      const wrapped =
        options?.ignoreSelf === true
          ? (broadcast: { origin?: string }) => {
              if (broadcast.origin !== selfOrigin) return handler(broadcast);
            }
          : handler;
      return track(() => ({ dispose: on(event, wrapped as never) }));
    }) as never;

  const ctx: PluginContext = {
    manifest,
    appVersion,
    // Live read — the worker mirrors this via the sync channel instead.
    get locale() {
      return currentAppLocale();
    },
    lifecycle: {
      get phase() {
        return lifecycle.phase;
      },
    },
    capabilities: resolvePluginCapabilities(manifest),
    domains: {
      settings: {
        queries: {
          snapshot: async query => {
            lifecycle.signal.throwIfAborted();
            const result = await settingsDomain.queries.snapshot(query);
            lifecycle.signal.throwIfAborted(); return result;
          },
          observe: (query, handler) => track(() => ({ dispose: settingsDomain.queries.observe(query, handler) })),
          discover: async query => {
            lifecycle.signal.throwIfAborted();
            const result = await settingsDomain.queries.discover(query);
            lifecycle.signal.throwIfAborted(); return result;
          },
          read: async (path, target) => {
            lifecycle.signal.throwIfAborted();
            const result = await settingsDomain.queries.read(path, target);
            lifecycle.signal.throwIfAborted(); return result;
          },
        },
        commands: {
          update: changes => {
            lifecycle.assertActive("domains.settings.commands.update");
            return settingsDomain.commands.update(changes, lifecycle.signal);
          },
        },
        events: {
          subscribe: (handler, options) =>
            track(() => ({
              dispose: settingsDomain.events.subscribe((event) => {
                if (options?.ignoreSelf && event.origin === selfOrigin) return;
                const report = (error: unknown) =>
                  log.error(`settings handler from "${manifest.id}" failed`, error);
                try {
                  const result = handler(event) as unknown;
                  if (result instanceof Promise) result.catch(report);
                } catch (error) {
                  report(error);
                }
              }),
            })),
        },
      },
    },
    contributions: {
      selectionActions: {
        register: (action) =>
          trackAction(() =>
            registerSelectionActionContribution({
              ...action,
              ...brand,
              key: contributionKey(manifest.id, action.id),
            }),
          ),
      },
      headerActions: {
        register: (action) =>
          trackAction(() =>
            registerHeaderActionContribution({
              ...action,
              ...brand,
              presentation:
                action.surface === "reader" ? "popup" : (action.presentation ?? "popup"),
              key: contributionKey(manifest.id, action.id),
            }),
          ),
      },
      commands: {
        register: (command) =>
          trackAction(() =>
            registerCommandContribution({
              ...command,
              defaultShortcut: normalizeDefaultShortcut(command.defaultShortcut),
              ...brand,
              key: contributionKey(manifest.id, command.id),
            }),
          ),
      },
      settingsOptions: {
        register: (fieldId, provider) => {
          const id = String(fieldId);
          const declared = manifest.settings?.find((field) => field.id === id);
          if (!declared || declared.kind !== "select" || declared.dynamicOptions !== true) {
            throw new Error(
              `settings field "${id}" is not declared as a dynamicOptions select in manifest.settings`,
            );
          }
          if (typeof provider !== "function") {
            throw new Error("settingsOptions.register requires a provider function");
          }
          return track(() =>
            registerSettingsOptionsContribution({
              key: contributionKey(manifest.id, `settings-options.${id}`),
              pluginId: manifest.id,
              fieldId: id,
              resolve: (values) => Promise.resolve(provider(values)),
            }),
          );
        },
      },
      voiceProviders: {
        register: (provider) => {
          return track(() => {
            const key = contributionKey(manifest.id, provider.id);
            let registeredProvider: Parameters<typeof registerVoiceProviderContribution>[0] = {
              ...provider,
              ...brand,
              key,
              voices: [],
            };
            const registration = registerVoiceProviderContribution(registeredProvider);
            const refreshVoices = () => {
              Promise.resolve(provider.listVoices())
                .then((voices) => {
                  const replacement = updateVoiceProviderVoices(
                    key,
                    Array.isArray(voices) ? voices : [],
                    registeredProvider,
                  );
                  if (replacement) registeredProvider = replacement;
                })
                .catch((error) =>
                  log.warn(`listVoices from "${manifest.id}" failed`, error),
                );
            };
            refreshVoices();
            const offStorage = onAppEvent("plugin-storage-changed", ({ pluginId }) => {
              if (pluginId === manifest.id) refreshVoices();
            });
            return {
              dispose: () => {
                offStorage();
                registration.dispose();
              },
            };
          });
        },
      },
      contentProviders: {
        register: (provider) =>
          track(() =>
            registerContentProviderContribution({
              key: `${manifest.id}:${provider.id}`,
              pluginId: manifest.id,
              providerId: String(provider.id),
              load: (bookKey: string) => Promise.resolve(provider.load(bookKey)),
            }),
          ),
      },
      readerModes: canUseContribution("readerModes", permissions)
        ? {
            register: (mode) => {
              const normalized = normalizeReaderMode(mode);
              return track(() =>
                registerReaderModeContribution({
                  ...normalized,
                  ...brand,
                  key: contributionKey(manifest.id, normalized.id),
                }),
              );
            },
          }
        : undefined,
      agentTools: canUseContribution("agentTools", permissions)
        ? {
            register: (tool) =>
              trackAction(() =>
                registerToolContribution({
                  ...tool,
                  ...brand,
                  key: contributionKey(manifest.id, tool.name),
                }),
              ),
          }
        : undefined,
      agentContextProviders: canUseContribution("agentContextProviders", permissions)
        ? {
            register: (provider) =>
              track(() =>
                registerAgentContextProviderContribution({
                  ...provider,
                  ...brand,
                  key: contributionKey(manifest.id, provider.id),
                }),
              ),
          }
        : undefined,
      agentRetrievalProviders: canUseContribution("agentRetrievalProviders", permissions)
        ? {
            register: (provider) =>
              track(() =>
                registerAgentRetrievalProviderContribution({
                  ...provider,
                  ...brand,
                  key: contributionKey(manifest.id, provider.id),
                }),
              ),
          }
        : undefined,
      memoryCandidateProviders: canUseContribution("memoryCandidateProviders", permissions)
        ? {
            register: (provider) =>
              track(() =>
                registerMemoryCandidateProviderContribution({
                  ...provider,
                  ...brand,
                  key: contributionKey(manifest.id, provider.id),
                }),
              ),
          }
        : undefined,
      syncTransports: canUseContribution("syncTransports", permissions)
        ? {
            register: (transport) => {
              if (!NAMESPACE_KEY.test(String(transport?.id))) {
                throw new Error(`invalid sync transport id: ${String(transport?.id)}`);
              }
              if (typeof transport.open !== "function") {
                throw new Error("syncTransports.register requires an open() function");
              }
              return track(() => {
                const unregister = registerSyncTransport(manifest.id, {
                  id: String(transport.id),
                  label: transport.label,
                  open: transport.open,
                }, releasePluginCallbacks);
                let disposed = false;
                const dispose = () => {
                  if (disposed) return;
                  disposed = true;
                  lifecycle.signal.removeEventListener("abort", dispose);
                  lifecycle.trackCleanup(unregister());
                };
                // Retire session waiters before native cancellation races back
                // through provider callbacks during the quiescence barrier.
                lifecycle.signal.addEventListener("abort", dispose, { once: true });
                if (lifecycle.signal.aborted) dispose();
                return { dispose };
              });
            },
          }
        : undefined,
    },
    services: {
      storage: {
        get: (key) => {
          const raw = localKV.getItem(storagePrefix + key);
          if (raw == null) return null;
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        },
        set: (key, value) => {
          return lifecycle.storageWrite("services.storage.set", () =>
            localKV.setItemAsync(storagePrefix + key, JSON.stringify(value ?? null), selfOrigin));
        },
        remove: (key) => {
          return lifecycle.storageWrite("services.storage.remove", () => localKV.removeItemAsync(storagePrefix + key, selfOrigin));
        },
        flush: async () => {
          await lifecycle.drainStorageWrites();
          await flushLocalKV(storagePrefix);
        },
        onChange: (handler) =>
          track(() => ({
            dispose: onAppEvent("plugin-storage-changed", ({ pluginId }) => {
              if (pluginId !== manifest.id) return;
              try {
                void Promise.resolve(handler()).catch(error => {
                  log.error(`storage.onChange handler from "${manifest.id}" failed`, error);
                });
              } catch (error) {
                log.error(`storage.onChange handler from "${manifest.id}" failed`, error);
              }
            }),
          })),
        collection: (name) => {
          const collection = String(name);
          if (!NAMESPACE_KEY.test(collection)) {
            throw new Error(`invalid collection name: ${collection}`);
          }
          return {
            put: (id, data, options) => {
              return lifecycle.storageWrite("services.storage.collection.put", () => pluginDocsPut(
                manifest.id,
                collection,
                String(id),
                JSON.stringify(data ?? null),
                { bookId: options?.bookId, anchor: options?.anchor },
              ));
            },
            get: async (id) => {
              const row = await pluginDocsGet(manifest.id, collection, String(id));
              return (row ? toPluginDocument(row) : null) as never;
            },
            delete: (id) => {
              return lifecycle.storageWrite("services.storage.collection.delete", () => pluginDocsDelete(manifest.id, collection, String(id)));
            },
            list: async (filter) =>
              (
                await pluginDocsList(manifest.id, collection, {
                  bookId: filter?.bookId,
                  limit: filter?.limit,
                  oldestFirst: filter?.oldestFirst,
                })
              ).map(toPluginDocument) as never,
          };
        },
      },
      secrets: {
        get: (key) => {
          lifecycle.assertActive("services.secrets.get");
          requireSecretKey(key);
          return getPluginSecret(manifest.id, key);
        },
        set: async (key, value) => {
          lifecycle.assertActive("services.secrets.set");
          requireSecretKey(key);
          await setPluginSecret(manifest.id, key, String(value));
        },
        remove: async (key) => {
          lifecycle.assertActive("services.secrets.remove");
          requireSecretKey(key);
          await deletePluginSecret(manifest.id, key);
        },
      },
      ui: {
        publishView: async (channel, update) => {
          lifecycle.assertActive("services.ui.publishView");
          return publishPluginView(lifecycle.signal, channel, update);
        },
        showToast: (message) => {
          lifecycle.assertActive("services.ui.showToast");
          showPluginToast(String(message));
        },
        exportFile: (file) => {
          lifecycle.assertActive("services.ui.exportFile");
          return hostIO.exportFile(file, lifecycle.signal);
        },
      },
      schedules: {
        list: async (query = {}) => { lifecycle.assertActive("services.schedules.list"); return pluginSchedules.list({ ...query, pluginId: manifest.id }); },
        observe: (query, handler) => track(() => ({ dispose: pluginSchedules.observe({ ...query, pluginId: manifest.id }, handler) })),
        control: (id, action) => { lifecycle.assertActive("services.schedules.control"); return pluginSchedules.control({ pluginId: manifest.id, id, action }, lifecycle.signal); },
        bind: (scheduleId, run) => {
          const declaration = manifest.schedules?.find(
            (entry) => entry.id === scheduleId,
          );
          if (!declaration) {
            throw new Error(
              `schedule "${scheduleId}" is not declared in manifest.schedules`,
            );
          }
          return track(() => {
            const registration = registerPluginSchedule(manifest.id, declaration, run);
            return { dispose: () => { registration.dispose(); lifecycle.trackCleanup(pluginSchedules.drainWrites(manifest.id)); } };
          });
        },
      },
      plugins: {
        list: async query => {
          lifecycle.assertActive("services.plugins.list");
          return pluginDirectory.list(query);
        },
        observe: (query, handler) => track(() => ({ dispose: pluginDirectory.observe(query, handler) })),
      },
      maintenance: {
        snapshot: async () => { lifecycle.assertActive("services.maintenance.snapshot"); return hostMaintenance.snapshot(); },
        observe: handler => track(() => ({ dispose: hostMaintenance.observe(handler) })),
        openSettings: surface => { lifecycle.assertActive("services.maintenance.openSettings"); return hostMaintenance.openSettings(surface, lifecycle.signal); },
        ...(canUseHostService("network", permissions) ? {
          checkForUpdates: () => { lifecycle.assertActive("services.maintenance.checkForUpdates"); return hostMaintenance.checkForUpdates(lifecycle.signal); },
        } : {}),
      },
      resources: {
        pick: options => { lifecycle.assertActive("services.resources.pick"); return resources.pick(options, lifecycle.signal); },
        ...(permissions.has("library:read") || permissions.has("library:write") ? {
          openBook: (bookId: string) => { lifecycle.assertActive("services.resources.openBook"); return resources.openBook(bookId, lifecycle.signal); },
          openCover: (bookId: string) => { lifecycle.assertActive("services.resources.openCover"); return resources.openCover(bookId, lifecycle.signal); },
        } : {}),
        create: options => { lifecycle.assertActive("services.resources.create"); return resources.create(options, lifecycle.signal); },
        stat: id => { lifecycle.assertActive("services.resources.stat"); return resources.stat(id, lifecycle.signal); },
        read: (id, offset, length) => { lifecycle.assertActive("services.resources.read"); return resources.read(id, offset, length, lifecycle.signal); },
        append: (id, offset, data) => { lifecycle.assertActive("services.resources.append"); return resources.append(id, offset, data, lifecycle.signal); },
        commit: id => { lifecycle.assertActive("services.resources.commit"); return resources.commit(id, lifecycle.signal); },
        save: (id, filename) => { lifecycle.assertActive("services.resources.save"); return resources.save(id, filename, lifecycle.signal); },
        release: id => { lifecycle.assertActive("services.resources.release"); return resources.release(id); },
      },
      session: {
        environment: async () => {
          lifecycle.assertActive("services.session.environment");
          return hostEnvironment.snapshot();
        },
        observeEnvironment: handler => track(() => ({ dispose: hostEnvironment.observe(handler) })),
      },
    },
  };

  // The registry already applied domain permissions. This layer only adapts
  // host-only details such as tracked subscriptions and virtual-book bindings.
  if (domain.library) {
    const library = domain.library;
    const commands = actorHostCommands(settingsDomain, true, !!library.commands, !!domain.reading?.commands);
    ctx.services.ui.commands = {
      observe: handler => track(() => ({ dispose: commands.observe(handler) })),
      list: async () => {
        lifecycle.assertActive("services.ui.commands.list");
        return commands.list(lifecycle.signal);
      },
      ...(library.commands ? { execute: (request: import("@read-aware/core").HostCommandRequest) => {
        lifecycle.assertActive("services.ui.commands.execute");
        return commands.execute(request, lifecycle.signal);
      } } : {}),
    };
    ctx.services.ui.workspace = {
      snapshot: async query => { lifecycle.assertActive("services.ui.workspace.snapshot"); return workspace.snapshot(query); },
      observe: (query, handler) => track(() => ({ dispose: workspace.observe(query, handler) })),
      ...(library.commands ? { navigate: (target: import("@read-aware/core").WorkspaceTarget, expectedRevision?: number) => {
        lifecycle.assertActive("services.ui.workspace.navigate");
        return workspace.navigate(target, expectedRevision, lifecycle.signal, !!domain.reading?.commands);
      } } : {}),
    };
    ctx.domains.library = {
      queries: {
        ...library.queries,
        books: {
          ...library.queries.books,
          inspectResource: id => lifecycle.read("library.inspectResource", () => inspectResourceBook(resources, id, lifecycle.signal)),
          getNavigationToc: (bookId) => lifecycle.read("library.getNavigationToc", () => library.queries.books.getNavigationToc(bookId, lifecycle.signal)),
          searchLocations: (input) => lifecycle.read("library.searchLocations", () => library.queries.books.searchLocations(input, lifecycle.signal)),
          readRange: (input) => lifecycle.read("library.readRange", () => library.queries.books.readRange(input, lifecycle.signal)),
          searchText: (input) => library.queries.books.searchText(input, lifecycle.signal),
          listRemovalCleanup: library.queries.books.listRemovalCleanup,
        },
      },
      events: {
        subscribe: trackedOn(library.events.subscribe),
        observeTextTask: (bookId, taskId, listener) => track(() => ({ dispose: library.events.observeTextTask(bookId, taskId, listener) })),
        observeEnrichment: (bookId, listener) => track(() => ({ dispose: library.events.observeEnrichment(bookId, listener) })),
      },
    };
    if (library.commands) {
      const commands = {
        books: {
          prepareText: library.commands.books.prepareText,
          retryEnrichment: (bookId: string) => library.commands!.books.retryEnrichment(bookId, lifecycle.signal),
          mergeDuplicates: (input: import("@read-aware/core").BookMergeRequest) => library.commands!.books.mergeDuplicates(input, lifecycle.signal),
          cancelTextTask: library.commands.books.cancelTextTask,
          importBook: library.commands.books.importBook,
          importResource: (id: string) => importResourceBook(resources, id, selfOrigin, lifecycle.signal),
          editMetadata: library.commands.books.editMetadata,
          setStarred: library.commands.books.setStarred,
          remove: library.commands.books.remove,
          removeMany: library.commands.books.removeMany,
          retryRemovalCleanup: library.commands.books.retryRemovalCleanup,
          addVirtualBook: async (
            input: Parameters<
              NonNullable<
                NonNullable<PluginContext["domains"]["library"]>["commands"]
              >["books"]["addVirtualBook"]
            >[0],
          ) => {
          const binding = {
            pluginId: manifest.id,
            providerId: String(input.providerId),
            key: String(input.key),
          };
          const existingId = findVirtualBookId(binding);
          if (existingId) {
            // The binding may be an orphan (book deleted before cleanup
            // existed, or through an untracked path) — verify the record.
            const alive = await library.queries.books.get(existingId);
            if (alive) {
              await library.commands!.books.updateVirtualBookTitle(
                existingId,
                String(input.title),
                input.author,
              );
              return {
                ...alive,
                title: String(input.title),
                author: input.author ?? alive.author,
              };
            }
            unbindVirtualBook(existingId);
          }
          const book = await library.commands!.books.addVirtualBook({
            title: String(input.title),
            author: input.author,
          });
          bindVirtualBook(book.id, binding);
          return book;
        },
          removeVirtualBook: async (
            input: Parameters<
              NonNullable<
                NonNullable<PluginContext["domains"]["library"]>["commands"]
              >["books"]["removeVirtualBook"]
            >[0],
          ) => {
          await removeOwnedVirtualBook({
            pluginId: manifest.id,
            providerId: String(input.providerId),
            key: String(input.key),
          }, library.commands!.books.remove);
          },
        },
        collections: library.commands.collections,
      };
      ctx.domains.library.commands = guardMutationTree(
        commands,
        (operation) => lifecycle.assertActive(operation),
        "domains.library.commands",
      );
    }
  }

  if (domain.reading) {
    const reading = domain.reading;
    ctx.services.ui.reader = {
      snapshot: async () => {
        lifecycle.assertActive("services.ui.reader.snapshot");
        return readerPanels.snapshot();
      },
      observe: handler => track(() => ({ dispose: readerPanels.observe(handler) })),
      ...(reading.commands ? { setPanel: (panel: import("@read-aware/core").ReaderPanel, open: boolean, guard?: import("@read-aware/core").ReadingSessionGuard) => {
        lifecycle.assertActive("services.ui.reader.setPanel");
        return readerPanels.setPanel(panel, open, lifecycle.signal, guard);
      } } : {}),
    };
    ctx.domains.reading = {
      queries: reading.queries,
      events: {
        subscribe: trackedOn(reading.events.subscribe),
        observeSession: handler => track(() => ({ dispose: reading.events.observeSession(handler) })),
        observeEmphasis: handler => track(() => ({ dispose: reading.events.observeEmphasis(handler) })),
        observeTime: (query, handler) => track(() => ({ dispose: reading.events.observeTime(query, handler) })),
      },
    };
    if (reading.commands) {
      ctx.domains.reading.commands = guardMutationTree(
        {
        setFinished: reading.commands.setFinished,
        putEmphasis: (input: import("@read-aware/core").ReadingEmphasisWrite, guard?: import("@read-aware/core").ReadingSessionGuard) => reading.commands!.putEmphasis(input, lifecycle.signal, guard),
        removeEmphasis: (input: import("@read-aware/core").ReadingEmphasisRef, guard?: import("@read-aware/core").ReadingSessionGuard) => reading.commands!.removeEmphasis(input, lifecycle.signal, guard),
        selectRange: (range: import("@read-aware/core").BookTextRange, guard?: import("@read-aware/core").ReadingSessionGuard) => reading.commands!.selectRange(range, lifecycle.signal, guard),
        clearSelection: (expectedId: string, guard?: import("@read-aware/core").ReadingSessionGuard) => reading.commands!.clearSelection(expectedId, lifecycle.signal, guard),
        openBook: (bookId: string) => reading.commands!.openBook(bookId, lifecycle.signal),
        goTo: (target: import("@read-aware/core").ReadingTarget) => reading.commands!.goTo(target, lifecycle.signal),
        back: (guard?: import("@read-aware/core").ReadingSessionGuard) => reading.commands!.back(lifecycle.signal, guard),
        forward: (guard?: import("@read-aware/core").ReadingSessionGuard) => reading.commands!.forward(lifecycle.signal, guard),
        step: (direction: "next" | "previous", guard?: import("@read-aware/core").ReadingSessionGuard) => reading.commands!.step(direction, lifecycle.signal, guard),
        close: (guard?: import("@read-aware/core").ReadingSessionGuard) => reading.commands!.close(lifecycle.signal, guard),
        controlPlayback: (action: "start" | "stop", guard?: import("@read-aware/core").ReadingSessionGuard) => reading.commands!.controlPlayback(action, lifecycle.signal, guard),
        configureMode: (input: import("@read-aware/core").ReadingModeConfiguration, guard?: import("@read-aware/core").ReadingSessionGuard) => reading.commands!.configureMode(input, lifecycle.signal, guard),
        setControls: (visible: boolean, guard?: import("@read-aware/core").ReadingSessionGuard) => reading.commands!.setControls(visible, lifecycle.signal, guard),
        returnToMode: (guard?: import("@read-aware/core").ReadingSessionGuard) => reading.commands!.returnToMode(lifecycle.signal, guard),
        stepMode: (direction: "next" | "previous", guard?: import("@read-aware/core").ReadingSessionGuard) => reading.commands!.stepMode(direction, lifecycle.signal, guard),
        },
        (operation) => lifecycle.assertActive(operation),
        "domains.reading.commands",
      );
    }
  }

  if (domain.annotations) {
    const annotations = domain.annotations;
    ctx.domains.annotations = {
      queries: annotations.queries,
      events: { subscribe: trackedOn(annotations.events.subscribe),
        observe: (query, handler) => track(() => ({ dispose: annotations.events.observe(query, handler) })),
      },
    };
    if (annotations.commands) {
      ctx.domains.annotations.commands = guardMutationTree(
        {
        createHighlight: annotations.commands.createHighlight,
        applyChanges: (changes: import("@read-aware/core").AnnotationMutation[]) => annotations.commands!.applyChanges(changes, lifecycle.signal),
        createNote: annotations.commands.createNote,
        },
        (operation) => lifecycle.assertActive(operation),
        "domains.annotations.commands",
      );
    }
  }

  if (domain.conversations) {
    ctx.domains.conversations = {
      queries: domain.conversations.queries,
      events: {
        observeRuntime: handler => track(() => ({ dispose: domain.conversations!.events.observeRuntime(handler) })),
        subscribe: trackedOn(domain.conversations.events.subscribe),
      },
      ...(domain.conversations.commands ? { commands: {
        requestTurn: (request: import("@read-aware/core").ConversationTurnRequest) => { lifecycle.assertActive("conversations.requestTurn"); return domain.conversations!.commands!.requestTurn(request, lifecycle.signal); },
        cancelTurnRequest: (id: string) => { lifecycle.assertActive("conversations.cancelTurnRequest"); return domain.conversations!.commands!.cancelTurnRequest(id, lifecycle.signal); },
        createThread: () => { lifecycle.assertActive("conversations.createThread"); return domain.conversations!.commands!.createThread(lifecycle.signal); },
        selectThread: (id: string) => { lifecycle.assertActive("conversations.selectThread"); return domain.conversations!.commands!.selectThread(id, lifecycle.signal); },
        stop: (target: import("@read-aware/core").ConversationTarget) => { lifecycle.assertActive("conversations.stop"); return domain.conversations!.commands!.stop(target, lifecycle.signal); },
        clear: (target: import("@read-aware/core").ConversationTarget) => { lifecycle.assertActive("conversations.clear"); return domain.conversations!.commands!.clear(target, lifecycle.signal); },
      } } : {}),
    };
  }

  if (domain.memory) {
    const memory = domain.memory;
    ctx.domains.memory = { queries: memory.queries,
      events: { observe: (query, handler) => track(() => ({ dispose: memory.events.observe(query, handler) })) },
      ...(memory.commands ? { commands: { mutate: input => {
      lifecycle.assertActive("domains.memory.commands.mutate");
      return memory.commands!.mutate(input);
    }, classify: input => {
      lifecycle.assertActive("domains.memory.commands.classify");
      return memory.commands!.classify(input);
    }, startGraphTask: (bookId, mode, options) => {
      lifecycle.assertActive("domains.memory.commands.startGraphTask");
      if (!canUseHostService("llm", permissions)) throw new AppError("memory/forbidden", "Graph generation requires service:llm");
      return memory.commands!.startGraphTask(bookId, mode, options);
    }, retryGraphTask: (bookId, taskId, options) => {
      lifecycle.assertActive("domains.memory.commands.retryGraphTask");
      if (!canUseHostService("llm", permissions)) throw new AppError("memory/forbidden", "Graph generation requires service:llm");
      return memory.commands!.retryGraphTask(bookId, taskId, options);
    }, cancelGraphTask: (bookId, taskId) => {
      lifecycle.assertActive("domains.memory.commands.cancelGraphTask");
      return memory.commands!.cancelGraphTask(bookId, taskId);
    } } } : {}) };
  }

  // ─── Services ─────────────────────────────────────────────────────────────

  if (canUseHostService("sync", permissions)) {
    ctx.services.sync = {
      snapshot: async () => { lifecycle.assertActive("services.sync.snapshot"); return hostSync.snapshot(); },
      backlog: () => { lifecycle.assertActive("services.sync.backlog"); return hostSync.backlog(lifecycle.signal); },
      account: () => { lifecycle.assertActive("services.sync.account"); return hostSync.account(lifecycle.signal); },
      requestSync: () => { lifecycle.assertActive("services.sync.requestSync"); return hostSync.requestSync(lifecycle.signal); },
      openSettings: () => { lifecycle.assertActive("services.sync.openSettings"); return hostSync.openSettings(lifecycle.signal); },
      observe: handler => track(() => ({ dispose: hostSync.observe(handler) })),
    };
  }

  if (canUseHostService("network", permissions)) {
    ctx.services.network = {
      // The Rust HTTP client (tauri-plugin-http), not webview fetch: plugin
      // requests must reach hosts that never heard of CORS. Scope lives in
      // the capability file (https + localhost), not in the webview CSP.
      fetch: (input, init) => {
        lifecycle.assertActive("services.network.fetch");
        return corsFreeFetch(input, init);
      },
    };
  }

  if (canUseHostService("llm", permissions)) {
    const ask = async (input: {
      prompt: string;
      readingContext?: import("@read-aware/core").ModelReadingContext;
      system?: string;
      model?: "fast" | "smart";
      schema?: Record<string, unknown>;
      onText?: (delta: string) => void;
    }) => {
      lifecycle.assertActive("services.llm.ask");
      const runtime = getAgentRuntime();
      // Typed so the code survives the sandbox bridge and surfaces (e.g. the
      // dictionary dialog) can render "connect a provider" copy with a
      // settings link instead of a generic failure.
      if (!runtime) throw new AiNotConfiguredError();
      const base = {
        prompt: String(input.prompt),
        readingContext: input.readingContext,
        system: input.system,
        model: input.model === "smart" ? ("smart" as const) : ("fast" as const),
      };
      if (input.schema && typeof input.schema === "object") {
        return runtime.ask({ ...base, schema: input.schema });
      }
      return runtime.ask({
        ...base,
        onText: typeof input.onText === "function" ? input.onText : undefined,
      });
    };
    ctx.services.llm = { ask } as PluginContext["services"]["llm"];
  }

  if (canUseHostService("clipboard", permissions)) {
    ctx.services.clipboard = {
      writeImage: id => {
        lifecycle.assertActive("services.clipboard.writeImage");
        return resources.copyImage(id, lifecycle.signal);
      },
      writeText: (text) => {
        lifecycle.assertActive("services.clipboard.writeText");
        return hostIO.writeClipboard(text, lifecycle.signal);
      },
    };
  }

  if (canUseHostService("network", permissions)) {
    ctx.services.ui.openExternal = url => {
      lifecycle.assertActive("services.ui.openExternal");
      return hostIO.openExternal(url, lifecycle.signal);
    };
  }

  return { context: ctx, lifecycle };
}
