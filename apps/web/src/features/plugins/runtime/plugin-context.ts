import { prepareRuntimeTheme, readerThemeBases } from "./plugin-runtime-theme";
import { observeSnapshot } from "../../../domain/snapshot-observation";
import { createPluginJobs } from "./plugin-jobs";
import { createPluginChanges } from "./plugin-changes";
import { createPluginTransactions } from "./plugin-transactions";
import { bookServiceStorage, denyUnscopedServiceData } from "./plugin-service-storage";
import { pluginServices, type PluginServiceParticipant } from "./plugin-services";
import type { DomainActorOwners } from "../../../domain/actor-owners";
import { PluginEventReactions } from "./plugin-event-reactions";
import { attachPluginEventReactions, bindPluginEventContext } from "./plugin-event-context";
import { stampEventCause, copyEventCause, type DomainActor } from "../../../platform/domain-actor";
import { inferenceHistoryStorage } from "./plugin-inference-history-storage";
import { resourceModelImage } from "../../../services/model-image";
import { createPluginStoragePolicy } from "./plugin-storage-policy";
import { pluginUriRegistry } from "../lib/plugin-uri";
import { normalizeActionState } from "../lib/plugin-action-state";
import { assertToolApproval } from "../lib/plugin-tool-approval";
import { resolvePluginBookCards } from "./plugin-book-cards";
import { wrapReadingIntent } from "./plugin-reading-intents";
import { pluginDurableKV } from "./plugin-durable-kv";
import { scopePluginMemory } from "./plugin-scoped-memory";
import { scopePluginConversations } from "./plugin-scoped-conversations";
import { scopePluginWorkspace } from "./plugin-scoped-workspace";
/**
 * Builds the `ctx` handed to a plugin's activate(). This is a POLICY shell:
 * the data surface itself is the shared domain layer (src/domain), built
 * here with origin `plugin:<id>`; this module adds what is plugin-specific —
 * manifest permission gating (docs/plugins/plugin-system.md §4), contribution
 * branding and disposal tracking, virtual-book bindings, and the service
 * capabilities. Gating is API-level — it prevents accidental overreach, not
 * malice; the trust boundary is installation itself (§2). Within a domain,
 * write implies read.
 */
import { fetch as corsFreeFetch } from "@tauri-apps/plugin-http";
import { createPluginNetworkService } from "./plugin-network";
import type {
  PluginActionRegistration,
  PluginAnnotationsDomain,
  PluginCallOptions,
  PluginLibraryDomain,
  PluginReactionEvent,
  PluginReadingDomain,
} from "@read-aware/plugin-types";
import { restricted, restrictSurface, type RestrictedPolicy } from "./plugin-restricted-surface";
import { pluginOperationSignal } from "./plugin-call-options";
import { readerPanels } from "../../../services/reader-panels";
import { readerFocus } from "../../../services/reader-focus";
import { readerReferencePreview } from "../../../services/reader-reference-preview";
import { workspace } from "../../../services/workspace";
import { actorHostCommands } from "../../../services/host-command-runtime";
import { publishPluginView } from "../lib/plugin-view-channels";
import {
  AppError,
  canUseContribution,
  canUseHostService,
  domainGrantsFromPermissions,
  normalizeOperationAvailability,
  operationAvailability,
  normalizeEntityQuery,
  normalizeProfileInspectionQuery,
  type DomainEventType,
  type SettingsAccessPolicy,
} from "@read-aware/core";
import { DEFAULT_LOCALE, i18n, isAppLocale } from "../../../i18n";
import { onAppEvent } from "../../../platform/app-events";
import { hostIO } from "../../../services/host-io";
import { PluginContributionReactions } from "./plugin-contribution-reactions";
import type { HostActionRegistration } from "../state/interactive-contribution-registry";
import { pluginDirectory } from "../../../services/plugin-directory";
import { afterLocalKVWrites, flushLocalKV, localKV } from "../../../platform/local-store";
import { createLogger } from "../../../platform/logger";
import { hostEnvironment } from "../../../platform/host-environment";
import { hostWindow } from "../../../services/window";
import { readerImage } from "../../../services/reader-image";
import { readerImageOpen } from "../../../services/reader-image-open";
import { checkOperationAvailability } from "../../../services/operation-availability";
import { readBookImage } from "../../library/lib/book-images";
import { openBookImageResource } from "../../../domain/library-book-images";
import { hostSync } from "../../../services/sync";
import { hostMaintenance } from "../../../services/maintenance";
import { hostDiagnostics } from "../../../services/diagnostics";
import { createPluginAssets } from "./plugin-assets";
import { createResourceOwner } from "../../../services/resources";
import { registerPluginImageOwner } from "../lib/plugin-image-owner";
import { registerPluginFileDropOwner } from "../lib/plugin-file-drop";
import { importResourceBook } from "../../../domain/library-resource-import";
import { createBookImportTasks } from "../../../domain/library-import-tasks";
import { inspectResourceBook } from "../../../domain/book-inspection";
import { deletePluginSecret, getPluginSecret, setPluginSecret } from "../../../platform/secret-store";
import { createActorDomainView, createSettingsDomain, type DomainEventSubscribe } from "../../../domain";
import { getAgentRuntime } from "../../ai/agent/agent-runtime";
import { createPluginLlm } from "./plugin-llm";
import {
  withVirtualBookBinding,
  findVirtualBookId,
  removeOwnedVirtualBook,
  invalidateOwnedVirtualBook,
  unbindVirtualBookDurably,
} from "../lib/virtual-books";
import { showPluginToast } from "../lib/plugin-toast";
import { normalizeReaderMode } from "../lib/reader-mode";
import { pluginSchedules, registerPluginSchedule } from "./plugin-scheduler";
import { resolvePluginCapabilities } from "./plugin-capabilities";
import {
  contributionKey,
  type PluginBookAccess,
  type PluginContext,
  type PluginDisposable,
  type PluginManifest,
} from "../lib/plugin-types";
import { registerSyncTransport } from "../../../platform/sync/transport-registry";
import { releasePluginCallbacks } from "./plugin-callback-wire";
import { createPluginDocuments } from "./plugin-documents";
import { PluginDocumentObserver } from "./plugin-document-observer";
import { createPluginLogging } from "./plugin-logging";
import {
  registerThemeContribution,
  registerSettingsPageContribution,
  registerCommandContribution,
  registerContextActionContribution,
  registerAgentContextProviderContribution,
  registerAgentRetrievalProviderContribution,
  registerHeaderActionContribution,
  registerReaderModeContribution,
  registerSelectionActionContribution,
  registerSettingsOptionsContribution,
  registerToolContribution,
  registerMemoryCandidateProviderContribution,
} from "../state/plugin-store";
import { PluginLifecycleController } from "./plugin-lifecycle";
import { registerPluginVoiceProvider } from "./plugin-voice-provider";
import { registerPluginContentProvider } from "./plugin-content-provider";
import {
  createPluginBookAccessPolicy,
  pluginObjectAccessDenied,
  type CurrentBookSnapshot,
  type PluginBookAccessFenceOptions,
  type PluginBookAccessPolicy,
} from "../../../domain/plugin-object-access";
import { readingRuntime } from "../../../domain/reading-runtime";
import { settled } from "../../../platform/write-settlement";

const log = createLogger("plugins");

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
  reactions: PluginEventReactions;
  contextForActor(actor: DomainActor): PluginContext;
  registrationForActor<T extends PluginDisposable>(
    registration: T,
    actor: DomainActor,
  ): import("@read-aware/plugin-types").PluginEventRegistration<T>;
  serviceParticipant: PluginServiceParticipant;
};

function guardMutationTree<T extends object>(value: T, assertActive: (operation: string) => void, path: string): T {
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

function combinePluginSignals(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const live = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  if (live.length === 0) return undefined;
  if (live.length === 1) return live[0];
  return AbortSignal.any(live);
}

export function buildPluginContext(
  manifest: PluginManifest,
  appVersion: string,
  disposables: PluginDisposable[],
  bookAccess: PluginBookAccess = { mode: "all" },
  serviceInvocation?: { origin: DomainActor; lineage: readonly string[] },
): PluginContextRuntime {
  // Keep the grant immutable inside this activation as well as on the Worker
  // wire. The caller owns the persisted object, while all policy closures
  // below must retain the exact grant selected for this activation.
  const grantedBookAccess = Object.freeze(
    bookAccess.mode === "book" ? { mode: "book" as const, bookId: bookAccess.bookId } : { mode: bookAccess.mode },
  ) as PluginBookAccess;
  const grantedMetadata = Object.freeze({ book: grantedBookAccess }) as PluginContext["grants"];
  const permissions = new Set(manifest.permissions ?? []);
  const selfOrigin = `plugin:${manifest.id}` as const;
  const lifecycle = new PluginLifecycleController(disposables);
  const callSignal = (options?: PluginCallOptions) => pluginOperationSignal(lifecycle.signal, options);
  let latestCurrent: CurrentBookSnapshot = (() => {
    const snapshot = readingRuntime.snapshot();
    return { bookId: snapshot.bookId, sessionId: snapshot.sessionId };
  })();
  if (grantedBookAccess.mode !== "all") {
    const dispose = readingRuntime.observe((snapshot) => {
      latestCurrent = { bookId: snapshot.bookId, sessionId: snapshot.sessionId };
    });
    disposables.push({ dispose });
  }
  const objectAccess: PluginBookAccessPolicy = createPluginBookAccessPolicy(
    grantedBookAccess,
    async () => {
      const snapshot = readingRuntime.snapshot();
      latestCurrent = { bookId: snapshot.bookId, sessionId: snapshot.sessionId };
      return latestCurrent;
    },
    grantedBookAccess.mode !== "all"
      ? (handler) =>
          readingRuntime.observe((snapshot) => handler({ bookId: snapshot.bookId, sessionId: snapshot.sessionId }))
      : undefined,
    () => latestCurrent,
  );
  const assertBookScope = (bookId: string): void => objectAccess.assertBook(bookId, "plugin book callback");
  const authorizeBook = (bookId: string): void => {
    if (!permissions.has("library:read") && !permissions.has("library:write")) {
      throw new AppError("memory/forbidden", "Book resources require library access");
    }
    objectAccess.assertBook(bookId, "book resource");
  };
  const scopedRead = async <T>(
    bookId: string,
    operation: string,
    run: (signal?: AbortSignal) => Promise<T>,
    options?: PluginCallOptions,
    verify?: (value: T) => void,
    fenceOptions?: PluginBookAccessFenceOptions,
  ): Promise<T> => {
    lifecycle.assertActive(operation);
    const fence = await objectAccess.beginBook(bookId, operation, fenceOptions);
    try {
      const result = await lifecycle.read(
        operation,
        (signal) => run(signal),
        combinePluginSignals(callSignal(options), fence.signal),
      );
      verify?.(result);
      await fence.assertUnchanged();
      return result;
    } catch (error) {
      fence.dispose();
      throw error;
    }
  };
  const scopedCurrentRead = async <T>(
    operation: string,
    run: (signal?: AbortSignal) => Promise<T>,
    options?: PluginCallOptions,
    verify?: (value: T) => void,
  ): Promise<T> => {
    lifecycle.assertActive(operation);
    const fence = await objectAccess.beginCurrent(operation);
    try {
      const result = await lifecycle.read(
        operation,
        (signal) => run(signal),
        combinePluginSignals(callSignal(options), fence.signal),
      );
      verify?.(result);
      await fence.assertUnchanged();
      return result;
    } catch (error) {
      fence.dispose();
      throw error;
    }
  };
  const scopedCommand = async <T>(
    bookId: string,
    operation: string,
    run: (signal?: AbortSignal) => Promise<T>,
    options?: PluginCallOptions,
    signalAware = true,
    verify?: (value: T) => void,
    fenceOptions?: PluginBookAccessFenceOptions,
  ): Promise<T> => {
    lifecycle.assertActive(operation);
    const fence = await objectAccess.beginBook(bookId, operation, fenceOptions);
    try {
      if (grantedBookAccess.mode === "current" && !signalAware) {
        throw pluginObjectAccessDenied(`${operation} requires a cancellable host write`);
      }
      const result = await run(combinePluginSignals(callSignal(options), fence.signal));
      verify?.(result);
      await fence.assertUnchanged();
      return result;
    } catch (error) {
      fence.dispose();
      throw error;
    }
  };
  const scopedCurrentCommand = async <T>(
    operation: string,
    run: (signal?: AbortSignal) => Promise<T>,
    options?: PluginCallOptions,
    signalAware = true,
    verify?: (value: T) => void,
    fenceOptions?: PluginBookAccessFenceOptions,
  ): Promise<T> => {
    lifecycle.assertActive(operation);
    const fence = await objectAccess.beginCurrent(operation, fenceOptions);
    try {
      if (grantedBookAccess.mode === "current" && !signalAware) {
        throw pluginObjectAccessDenied(`${operation} requires a cancellable host write`);
      }
      const result = await run(combinePluginSignals(callSignal(options), fence.signal));
      verify?.(result);
      await fence.assertUnchanged();
      return result;
    } catch (error) {
      fence.dispose();
      throw error;
    }
  };
  const referencePreviewOwner = {};
  lifecycle.signal.addEventListener(
    "abort",
    () => lifecycle.trackCleanup(readerReferencePreview.release(referencePreviewOwner)),
    { once: true },
  );
  const resources = createResourceOwner(authorizeBook, (ref, bookId) => {
    if (bookId !== undefined) authorizeBook(bookId);
    if (ref.source === "book" && bookId === undefined) {
      throw pluginObjectAccessDenied("book resource");
    }
  });
  lifecycle.signal.addEventListener("abort", () => lifecycle.trackCleanup(resources.dispose()), { once: true });
  registerPluginFileDropOwner(lifecycle.signal, manifest.name, resources);
  const importTasks = createBookImportTasks(resources, selfOrigin, lifecycle.signal, (work) =>
    lifecycle.trackCleanup(work),
  );
  registerPluginImageOwner(lifecycle.signal, (id, signal) => {
    lifecycle.assertActive("views.image");
    return resources.imagePreview(id, signal);
  });
  const activationLifecycle = {
    get phase() {
      return lifecycle.phase;
    },
  };
  const owners: DomainActorOwners = {};
  const documentObserver = new PluginDocumentObserver(lifecycle);
  const transactionBudget = { pending: 0 };
  let activationJobs: ReturnType<typeof createPluginJobs> | undefined;
  const logging = createPluginLogging(manifest.id, manifest.version, lifecycle);
  const scopedWorkspaceState = { revision: 0 };
  const scopedConversationState = { revision: 0 };
  let network: PluginContext["services"]["network"], llm: PluginContext["services"]["llm"];
  const reactions = new PluginEventReactions(selfOrigin, lifecycle.signal);
  lifecycle.signal.addEventListener("abort", () => lifecycle.trackCleanup(reactions.drain()), { once: true });
  const contributionHandles = new PluginContributionReactions(lifecycle, reactions, selfOrigin);
  const serviceParticipant = (origin: DomainActor): PluginServiceParticipant => ({
    manifest,
    access: objectAccess,
    signal: lifecycle.signal,
    origin,
    lineage: serviceInvocation?.lineage,
    assertLive: () => lifecycle.assertActive("plugin service"),
    track: (work) => lifecycle.trackCleanup(work),
  });
  const contexts = new WeakMap<object, PluginContext>();
  const contextForActor = (operationActor: DomainActor): PluginContext => {
    if (typeof operationActor === "object") {
      const cached = contexts.get(operationActor);
      if (cached) return cached;
    }
    let commandAvailability:
      | ((
          request: import("@read-aware/core").HostCommandRequest,
          signal: AbortSignal,
        ) => Promise<import("@read-aware/core").OperationAvailability>)
      | undefined;
    const documents = createPluginDocuments(manifest.id, lifecycle, undefined, operationActor, documentObserver);
    const domain = createActorDomainView(
      operationActor,
      domainGrantsFromPermissions(manifest.permissions ?? []),
      lifecycle.signal,
      (work) => lifecycle.trackCleanup(work),
      owners,
    );
    const ownSettingsPaths = (manifest.settings ?? [])
      .filter((field) => field.kind !== "secret" && !(field.kind === "text" && field.inputMode === "password"))
      .map((field) => `plugins.${manifest.id}.${field.id}`);
    const requestedSettings = manifest.settingsAccess ?? {};
    const settingsAccess: SettingsAccessPolicy = {
      discover: [...(requestedSettings.discover ?? []), ...ownSettingsPaths],
      read: [...(requestedSettings.read ?? []), ...ownSettingsPaths],
      write: [...(requestedSettings.write ?? []), ...ownSettingsPaths],
    };
    let transactionSession: ReturnType<typeof createPluginTransactions> | undefined;
    const transactions = () =>
      (transactionSession ??= createPluginTransactions(
        manifest,
        objectAccess,
        lifecycle,
        documentObserver,
        operationActor,
        settingsAccess,
        transactionBudget,
      ));
    if (operationActor === selfOrigin && !serviceInvocation)
      activationJobs ??= createPluginJobs(manifest, objectAccess, lifecycle, transactions(), operationActor);
    const jobs = () => {
      if (serviceInvocation || !activationJobs)
        throw new AppError("plugin/permission-denied", "Persistent jobs require an activation owner");
      return activationJobs;
    };
    const transactionCall = <T>(perform: () => Promise<T>): Promise<T> => {
      const pending = perform();
      lifecycle.trackCleanup(settled(pending));
      return pending;
    };
    const settingsDomain = createSettingsDomain(operationActor, settingsAccess, permissions.has("service:network"));
    const changes = createPluginChanges(manifest, objectAccess, lifecycle, operationActor, settingsDomain);
    const storagePrefix = pluginStoragePrefix(manifest.id);
    const track = (factory: () => PluginDisposable): PluginDisposable => lifecycle.stage(factory);
    const trackContribution = (
      factory: (source: DomainActor) => { dispose(source?: DomainActor): void },
    ): PluginDisposable => contributionHandles.stage(factory, operationActor);
    const trackAction = (factory: (source: DomainActor) => HostActionRegistration): PluginActionRegistration =>
      contributionHandles.action(factory, operationActor);
    const brand = { pluginId: manifest.id, pluginName: manifest.name };

    /**
     * Domain `on` returns a bare unsubscribe; plugins get a tracked disposable,
     * plus the `ignoreSelf` option that mutes this plugin's own write echoes.
     */
    const trackedOn = <E extends DomainEventType>(on: DomainEventSubscribe<E>) =>
      ((event: never, handler: (broadcast: { origin?: string }) => void, options?: { ignoreSelf?: boolean }) => {
        const wrapped =
          options?.ignoreSelf === true
            ? (broadcast: { origin?: string }) => {
                if (broadcast.origin !== selfOrigin) return handler(broadcast);
              }
            : handler;
        return track(() => ({ dispose: on(event, wrapped as never) }));
      }) as never;

    /** Settings handlers run inside the shared dispatcher; a failing plugin
     * handler is logged, never propagated to other subscribers. */
    type SettingsHandler = Parameters<PluginContext["domains"]["settings"]["events"]["subscribe"]>[0];
    const deliverSettingsEvent = (handler: SettingsHandler, event: Parameters<SettingsHandler>[0]): void => {
      const report = (error: unknown) => log.error(`settings handler from "${manifest.id}" failed`, error);
      try {
        const result = handler(event) as unknown;
        if (result instanceof Promise) result.catch(report);
      } catch (error) {
        report(error);
      }
    };

    const ctx: PluginContext = {
      withEvent: ((event: PluginReactionEvent | undefined, registration?: PluginDisposable) =>
        registration === undefined
          ? bindPluginEventContext(event, reactions, contextForActor)
          : contributionHandles.bind(event, registration)) as PluginContext["withEvent"],
      manifest,
      appVersion,
      // Live read — the worker mirrors this via the sync channel instead.
      get locale() {
        return currentAppLocale();
      },
      lifecycle: activationLifecycle,
      capabilities: resolvePluginCapabilities(manifest),
      grants: grantedMetadata,
      domains: {
        settings: {
          queries: {
            modelCatalog: (query) =>
              lifecycle.read("settings.modelCatalog", () => settingsDomain.queries.modelCatalog(query)),
            snapshot: async (query) => {
              lifecycle.signal.throwIfAborted();
              const result = await settingsDomain.queries.snapshot(query);
              lifecycle.signal.throwIfAborted();
              return result;
            },
            observe: (query, handler) => track(() => ({ dispose: settingsDomain.queries.observe(query, handler) })),
            discover: async (query) => {
              lifecycle.signal.throwIfAborted();
              const result = await settingsDomain.queries.discover(query);
              lifecycle.signal.throwIfAborted();
              return result;
            },
            options: async (query) => {
              // A plugin-owned list can invoke a provider, unlike static catalog reads.
              if (typeof query?.path === "string" && query.path.startsWith("plugins."))
                lifecycle.assertActive("settings.options");
              return lifecycle.read("settings.options", (signal) => settingsDomain.queries.options(query, signal));
            },
            read: async (path, target) => {
              lifecycle.signal.throwIfAborted();
              const result = await settingsDomain.queries.read(path, target);
              lifecycle.signal.throwIfAborted();
              return result;
            },
          },
          commands: {
            ...(permissions.has("service:network")
              ? {
                  refreshModelCatalog: (
                    provider: string,
                    options?: import("@read-aware/plugin-types").PluginCallOptions,
                  ) => {
                    // A shared network refresh is an external effect, so it waits for promotion like every other command.
                    lifecycle.assertActive("domains.settings.commands.refreshModelCatalog");
                    return lifecycle.read(
                      "settings.refreshModelCatalog",
                      (signal) => settingsDomain.commands.refreshModelCatalog(provider, signal),
                      callSignal(options),
                    );
                  },
                }
              : {}),
            resetReading: (request) => {
              lifecycle.assertActive("domains.settings.commands.resetReading");
              return settingsDomain.commands.resetReading(request, lifecycle.signal);
            },
            update: (changes) => {
              lifecycle.assertActive("domains.settings.commands.update");
              return settingsDomain.commands.update(changes, lifecycle.signal);
            },
          },
          events: {
            subscribe: (handler, options) =>
              track(() => ({
                dispose: settingsDomain.events.subscribe((event) => {
                  if (options?.ignoreSelf && event.origin === selfOrigin) return;
                  deliverSettingsEvent(handler, event);
                }),
              })),
          },
        },
      },
      contributions: {
        settingsPage: {
          register: (page) =>
            trackContribution((source) =>
              registerSettingsPageContribution(
                { ...brand, key: contributionKey(manifest.id, "settings"), view: page.view },
                source,
              ),
            ),
        },
        ...(canUseContribution("themes", permissions)
          ? {
              themes: {
                readerBases: () =>
                  lifecycle.read("themes.readerBases", async () => readerThemeBases(), lifecycle.signal),
                register: async (input) => {
                  const prepared = await prepareRuntimeTheme(input, manifest, lifecycle, resources);
                  return trackContribution((source) => {
                    const background = prepared.background;
                    const url = background ? URL.createObjectURL(background.blob) : undefined;
                    try {
                      const registration = registerThemeContribution(
                        {
                          ...prepared.theme,
                          ...brand,
                          key: contributionKey(manifest.id, prepared.theme.id),
                          readerBackground:
                            background && url ? { url, opacity: background.opacity, dim: background.dim } : undefined,
                        },
                        source,
                      );
                      return {
                        dispose: (origin) => {
                          registration.dispose(origin);
                          if (url) URL.revokeObjectURL(url);
                        },
                      };
                    } catch (error) {
                      if (url) URL.revokeObjectURL(url);
                      throw error;
                    }
                  });
                },
              },
            }
          : {}),
        uriHandlers: {
          register: (handler) => {
            if (
              !handler ||
              typeof handler !== "object" ||
              typeof handler.id !== "string" ||
              !NAMESPACE_KEY.test(handler.id) ||
              typeof handler.open !== "function"
            )
              throw new AppError("plugin/invalid-input", "Invalid URI handler");
            const captured = {
              id: handler.id,
              open: handler.open,
              ...(handler.state === undefined ? {} : { state: normalizeActionState(handler.state) }),
            };
            return trackAction((source) =>
              pluginUriRegistry.register(
                { ...captured, ...brand, key: contributionKey(manifest.id, captured.id) },
                source,
              ),
            );
          },
        },
        selectionActions: {
          register: (action) =>
            trackAction((source) =>
              registerSelectionActionContribution(
                {
                  ...action,
                  ...(objectAccess.restricted
                    ? {
                        run: (input) => {
                          assertBookScope(input.book.id);
                          if (input.range) assertBookScope(input.range.bookId);
                          return action.run(input);
                        },
                      }
                    : {}),
                  ...brand,
                  key: contributionKey(manifest.id, action.id),
                },
                source,
              ),
            ),
        },
        headerActions: {
          register: (action) =>
            trackAction((source) => {
              if (!["shelf", "reader", "agent"].includes(action.surface)) {
                throw new AppError("plugin/invalid-input", "Unknown header surface");
              }
              return registerHeaderActionContribution(
                {
                  ...action,
                  ...(objectAccess.restricted
                    ? {
                        view: (input) => {
                          if (input.book) assertBookScope(input.book.id);
                          return action.view(input);
                        },
                      }
                    : {}),
                  ...brand,
                  presentation: action.surface !== "shelf" ? "popup" : (action.presentation ?? "popup"),
                  key: contributionKey(manifest.id, action.id),
                },
                source,
              );
            }),
        },
        contextActions: {
          register: (action) =>
            trackAction((source) => {
              if (!["book", "collection"].includes(action.surface)) {
                throw new AppError("plugin/invalid-input", "Unknown context surface");
              }
              return registerContextActionContribution(
                {
                  ...action,
                  ...(objectAccess.restricted
                    ? {
                        run: (input) => {
                          if (input.surface === "book") assertBookScope(input.book.id);
                          return action.run(input);
                        },
                      }
                    : {}),
                  ...brand,
                  key: contributionKey(manifest.id, action.id),
                },
                source,
              );
            }),
        },
        commands: {
          register: (command) =>
            trackAction((source) =>
              registerCommandContribution(
                {
                  ...command,
                  defaultShortcut: normalizeDefaultShortcut(command.defaultShortcut),
                  ...brand,
                  key: contributionKey(manifest.id, command.id),
                },
                source,
              ),
            ),
        },
        settingsOptions: {
          register: (fieldId, provider) => {
            const id = String(fieldId);
            const declared = manifest.settings?.find((field) => field.id === id);
            if (!declared || declared.kind !== "select" || declared.dynamicOptions !== true) {
              throw new Error(`settings field "${id}" is not declared as a dynamicOptions select in manifest.settings`);
            }
            if (typeof provider !== "function") {
              throw new Error("settingsOptions.register requires a provider function");
            }
            return trackContribution((source) =>
              registerSettingsOptionsContribution(
                {
                  key: contributionKey(manifest.id, `settings-options.${id}`),
                  pluginId: manifest.id,
                  fieldId: id,
                  resolve: (values) => Promise.resolve(provider(values)),
                },
                source,
              ),
            );
          },
        },
        voiceProviders: {
          register: (provider) =>
            trackContribution((source) => registerPluginVoiceProvider(provider, brand, lifecycle, source)),
        },
        contentProviders: {
          register: (provider) =>
            trackContribution((source) =>
              registerPluginContentProvider(manifest.id, provider, lifecycle.signal, source),
            ),
        },
        readerModes: canUseContribution("readerModes", permissions)
          ? {
              register: (mode) => {
                const normalized = normalizeReaderMode(mode);
                return trackContribution((source) =>
                  registerReaderModeContribution(
                    {
                      ...normalized,
                      ...brand,
                      key: contributionKey(manifest.id, normalized.id),
                    },
                    source,
                  ),
                );
              },
            }
          : undefined,
        agentTools: canUseContribution("agentTools", permissions)
          ? {
              register: (tool) => {
                assertToolApproval(tool.approval, manifest.requires.contributions?.agentTools);
                return trackAction((source) =>
                  registerToolContribution(
                    {
                      ...tool,
                      ...brand,
                      key: contributionKey(manifest.id, tool.name),
                      resolveBookCards: domain.library
                        ? (ids, signal) =>
                            lifecycle.read(
                              "agentTools.bookCards",
                              (active) => resolvePluginBookCards(ids, ctx.domains.library!.queries.books.list, active),
                              signal,
                            )
                        : undefined,
                      ...(objectAccess.restricted
                        ? { bookAccess: grantedBookAccess, assertBookAccess: assertBookScope }
                        : {}),
                    },
                    source,
                  ),
                );
              },
            }
          : undefined,
        agentContextProviders: canUseContribution("agentContextProviders", permissions)
          ? {
              register: (provider) => {
                const readingIntent = wrapReadingIntent(provider.readingIntent, lifecycle);
                return trackContribution((source) =>
                  registerAgentContextProviderContribution(
                    {
                      ...provider,
                      ...brand,
                      key: contributionKey(manifest.id, provider.id),
                      provide: objectAccess.restricted
                        ? (input) => {
                            if (input.scope.kind === "book") {
                              assertBookScope(input.scope.bookId);
                              return scopedRead(input.scope.bookId, "agent context provider", () =>
                                Promise.resolve(provider.provide(input)),
                              );
                            }
                            if (grantedBookAccess.mode !== "all")
                              throw pluginObjectAccessDenied("agent context provider global scope");
                            return provider.provide(input);
                          }
                        : provider.provide,
                      readingIntent:
                        readingIntent && objectAccess.restricted
                          ? {
                              ...readingIntent,
                              prepare: (scope) => {
                                if (scope.kind === "book")
                                  return scopedRead(scope.id, "reading intention.prepare", () =>
                                    readingIntent.prepare(scope),
                                  );
                                else if (grantedBookAccess.mode !== "all")
                                  throw pluginObjectAccessDenied("reading intention global scope");
                                return readingIntent.prepare(scope);
                              },
                              read: (scope) => {
                                if (scope.kind === "book")
                                  return scopedRead(scope.id, "reading intention.read", () =>
                                    readingIntent.read(scope),
                                  );
                                else if (grantedBookAccess.mode !== "all")
                                  throw pluginObjectAccessDenied("reading intention global scope");
                                return readingIntent.read(scope);
                              },
                            }
                          : readingIntent,
                      readingIntentLifetime: lifecycle.signal,
                      ...(objectAccess.restricted
                        ? { bookAccess: grantedBookAccess, assertBookAccess: assertBookScope }
                        : {}),
                    },
                    source,
                  ),
                );
              },
            }
          : undefined,
        agentRetrievalProviders: canUseContribution("agentRetrievalProviders", permissions)
          ? {
              register: (provider) =>
                trackContribution((source) =>
                  registerAgentRetrievalProviderContribution(
                    {
                      ...provider,
                      ...brand,
                      key: contributionKey(manifest.id, provider.id),
                      retrieve: objectAccess.restricted
                        ? (input) => {
                            if (input.scope.kind === "book")
                              return scopedRead(input.scope.bookId, "agent retrieval provider", () =>
                                Promise.resolve(provider.retrieve(input)),
                              );
                            throw pluginObjectAccessDenied("agent retrieval provider global scope");
                          }
                        : provider.retrieve,
                      ...(objectAccess.restricted
                        ? { bookAccess: grantedBookAccess, assertBookAccess: assertBookScope }
                        : {}),
                    },
                    source,
                  ),
                ),
            }
          : undefined,
        memoryCandidateProviders: canUseContribution("memoryCandidateProviders", permissions)
          ? {
              register: (provider) =>
                trackContribution((source) =>
                  registerMemoryCandidateProviderContribution(
                    {
                      ...provider,
                      ...(objectAccess.restricted
                        ? {
                            propose: async (input) => {
                              if (input.scope.kind !== "book")
                                throw pluginObjectAccessDenied("memory candidate provider global scope");
                              const fence = await objectAccess.beginBook(
                                input.scope.bookId,
                                "memory candidate provider",
                              );
                              try {
                                const proposals = await provider.propose(input);
                                await fence.assertUnchanged();
                                if (
                                  !Array.isArray(proposals) ||
                                  proposals.some((candidate) => candidate.scope !== "book")
                                ) {
                                  throw pluginObjectAccessDenied("memory candidate provider result");
                                }
                                return proposals;
                              } catch (error) {
                                fence.dispose();
                                throw error;
                              }
                            },
                            bookAccess: grantedBookAccess,
                            assertBookAccess: assertBookScope,
                          }
                        : {}),
                      ...brand,
                      key: contributionKey(manifest.id, provider.id),
                    },
                    source,
                  ),
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
                return trackContribution((source) => {
                  const unregister = registerSyncTransport(
                    manifest.id,
                    {
                      id: String(transport.id),
                      label: transport.label,
                      open: transport.open,
                    },
                    releasePluginCallbacks,
                    source,
                  );
                  let disposed = false;
                  const dispose = (retirement: DomainActor = source) => {
                    if (disposed) return;
                    disposed = true;
                    lifecycle.signal.removeEventListener("abort", cancel);
                    lifecycle.trackCleanup(unregister(retirement));
                  };
                  const cancel = () => dispose(source);
                  // Retire session waiters before native cancellation races back
                  // through provider callbacks during the quiescence barrier.
                  lifecycle.signal.addEventListener("abort", cancel, { once: true });
                  if (lifecycle.signal.aborted) dispose();
                  return { dispose };
                });
              },
            }
          : undefined,
      },
      services: {
        storage: {
          policy: createPluginStoragePolicy(manifest.id, lifecycle),
          getDurable: pluginDurableKV(lifecycle, storagePrefix),
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
            if (typeof key !== "string" || key === "schedule-state" || key === "schedule-runs")
              throw new AppError("plugin/invalid-input", "Schedule receipts are host-owned");
            return lifecycle.storageWrite("services.storage.set", () =>
              localKV.setItemAsync(storagePrefix + key, JSON.stringify(value ?? null), operationActor),
            );
          },
          remove: (key) => {
            if (typeof key !== "string" || key === "schedule-state" || key === "schedule-runs")
              throw new AppError("plugin/invalid-input", "Schedule receipts are host-owned");
            return lifecycle.storageWrite("services.storage.remove", () =>
              localKV.removeItemAsync(storagePrefix + key, operationActor),
            );
          },
          flush: async () => {
            await lifecycle.drainStorageWrites();
            await flushLocalKV(storagePrefix);
          },
          onChange: (handler) =>
            track(() => ({
              dispose: observeSnapshot(
                () => ({ kind: "changed" as const }),
                (notify) =>
                  onAppEvent("plugin-storage-changed", (event) => {
                    if (event.pluginId === manifest.id) notify(event);
                  }),
                (value, source) => handler(copyEventCause(source, value)),
                (error) => log.error(`storage.onChange handler from "${manifest.id}" failed`, error),
                operationActor,
                false,
              ),
            })),
          ...documents,
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
            await lifecycle.storageWrite("services.secrets.set", () =>
              setPluginSecret(manifest.id, key, String(value), operationActor),
            );
          },
          remove: async (key) => {
            lifecycle.assertActive("services.secrets.remove");
            requireSecretKey(key);
            await lifecycle.storageWrite("services.secrets.remove", () =>
              deletePluginSecret(manifest.id, key, operationActor),
            );
          },
        },
        ui: {
          window: {
            snapshot: () => {
              lifecycle.assertActive("services.ui.window.snapshot");
              return lifecycle.read("services.ui.window.snapshot", () => hostWindow.snapshot(lifecycle.signal));
            },
            observe: (handler) => track(() => ({ dispose: hostWindow.observe(handler, operationActor) })),
            control: (request) => {
              lifecycle.assertActive("services.ui.window.control");
              return lifecycle.read("services.ui.window.control", () =>
                hostWindow.control(request, lifecycle.signal, operationActor),
              );
            },
          },
          publishView: async (channel, update) => {
            lifecycle.assertActive("services.ui.publishView");
            return publishPluginView(lifecycle.signal, channel, update);
          },
          showToast: (message) => {
            lifecycle.assertActive("services.ui.showToast");
            showPluginToast(message, lifecycle.signal);
          },
          exportFile: (file) => {
            lifecycle.assertActive("services.ui.exportFile");
            return hostIO.exportFile(file, lifecycle.signal);
          },
        },
        schedules: {
          defer: (id, input, options) => {
            lifecycle.assertActive("services.schedules.defer");
            return lifecycle.storageWrite("services.schedules.defer", () =>
              pluginSchedules.defer(manifest.id, id, input, callSignal(options), operationActor),
            );
          },
          cancelDeferred: (id, requestId, options) => {
            lifecycle.assertActive("services.schedules.cancelDeferred");
            return lifecycle.storageWrite("services.schedules.cancelDeferred", () =>
              pluginSchedules.cancelDeferred(manifest.id, id, requestId, callSignal(options), operationActor),
            );
          },
          list: async (query = {}) => {
            lifecycle.assertActive("services.schedules.list");
            return pluginSchedules.list({ ...query, pluginId: manifest.id });
          },
          observe: (query, handler) =>
            track(() => ({
              dispose: pluginSchedules.observe({ ...query, pluginId: manifest.id }, handler, operationActor),
            })),
          control: (id, action) => {
            lifecycle.assertActive("services.schedules.control");
            return pluginSchedules.control({ pluginId: manifest.id, id, action }, lifecycle.signal, operationActor);
          },
          bind: (scheduleId, run) => {
            const declaration = manifest.schedules?.find((entry) => entry.id === scheduleId);
            if (!declaration) {
              throw new Error(`schedule "${scheduleId}" is not declared in manifest.schedules`);
            }
            return trackContribution((source) => {
              const registration = registerPluginSchedule(manifest.id, declaration, run, manifest.version, source);
              return {
                dispose: (retirement) => {
                  registration.dispose(retirement);
                  lifecycle.trackCleanup(pluginSchedules.drainWrites(manifest.id));
                },
              };
            });
          },
        },
        changes: {
          open: (query, options) => transactionCall(() => changes.open(query, callSignal(options))),
          read: (query, cursor, limit, options) =>
            transactionCall(() => changes.read(query, cursor, limit, callSignal(options))),
        },
        jobs: {
          start: (plan, options) => transactionCall(() => jobs().start(plan, callSignal(options), operationActor)),
          get: async (id, options) => {
            const signal = callSignal(options);
            signal.throwIfAborted();
            const value = await jobs().get(id, signal);
            signal.throwIfAborted();
            return value;
          },
          list: async (query, options) => {
            const signal = callSignal(options);
            signal.throwIfAborted();
            const value = await jobs().list(query, signal);
            signal.throwIfAborted();
            return value;
          },
          control: (id, action, options) => transactionCall(() => jobs().control(id, action, callSignal(options))),
        },
        transactions: {
          preview: (operations, options) =>
            transactionCall(() => transactions().preview(operations, callSignal(options))),
          commit: (id, options) => transactionCall(() => transactions().commit(id, callSignal(options))),
          previewUndo: (id, options) => transactionCall(() => transactions().previewUndo(id, callSignal(options))),
          receipt: (id, options) => transactionCall(() => transactions().receipt(id, callSignal(options))),
        },
        plugins: {
          listServices: async (query, options) => {
            callSignal(options).throwIfAborted();
            return pluginServices.list(serviceParticipant(operationActor), query);
          },
          callService: (request, options) =>
            pluginServices.call(serviceParticipant(operationActor), request, callSignal(options)),
          contributions: async (query) => {
            lifecycle.assertActive("services.plugins.contributions");
            return pluginDirectory.contributions(query);
          },
          observeContributions: (query, handler) =>
            track(() => ({ dispose: pluginDirectory.observeContributions(query, handler, operationActor) })),
          list: async (query) => {
            lifecycle.assertActive("services.plugins.list");
            return pluginDirectory.list(query);
          },
          observe: (query, handler) =>
            track(() => ({ dispose: pluginDirectory.observe(query, handler, operationActor) })),
        },
        logging,
        ...(canUseHostService("diagnostics", permissions)
          ? {
              diagnostics: {
                requestProjectionRepair: (options) =>
                  lifecycle.read(
                    "services.diagnostics.requestProjectionRepair",
                    (signal) => hostDiagnostics.requestProjectionRepair(signal, operationActor),
                    pluginOperationSignal(lifecycle.signal, options),
                  ),
                requestReport: (action, options) =>
                  lifecycle.read(
                    "services.diagnostics.requestReport",
                    (signal) => hostDiagnostics.requestReport(action, signal, operationActor),
                    pluginOperationSignal(lifecycle.signal, options),
                  ),
                verifyProjections: (options?: PluginCallOptions) =>
                  lifecycle.read(
                    "services.diagnostics.verifyProjections",
                    (signal) => hostDiagnostics.verifyProjections(signal, operationActor),
                    callSignal(options),
                  ),
              },
            }
          : {}),
        maintenance: {
          requestConnectionTest: (options) =>
            lifecycle.read(
              "services.maintenance.requestConnectionTest",
              (signal) => hostMaintenance.requestConnectionTest(signal, operationActor),
              callSignal(options),
            ),
          requestBackup: (action, options) =>
            lifecycle.read(
              "services.maintenance.requestBackup",
              (signal) => hostMaintenance.requestBackup(action, signal, operationActor),
              callSignal(options),
            ),
          snapshot: async () => {
            lifecycle.assertActive("services.maintenance.snapshot");
            return hostMaintenance.snapshot();
          },
          observe: (handler) => track(() => ({ dispose: hostMaintenance.observe(handler, operationActor) })),
          openSettings: (surface) => {
            lifecycle.assertActive("services.maintenance.openSettings");
            return hostMaintenance.openSettings(surface, lifecycle.signal, operationActor);
          },
          ...(canUseHostService("network", permissions)
            ? {
                checkForUpdates: () => {
                  lifecycle.assertActive("services.maintenance.checkForUpdates");
                  return hostMaintenance.checkForUpdates(lifecycle.signal, operationActor);
                },
              }
            : {}),
        },
        resources: {
          pickDirectory: () => {
            lifecycle.assertActive("services.resources.pickDirectory");
            return resources.pickDirectory(lifecycle.signal);
          },
          listDirectory: (id, query) => {
            lifecycle.assertActive("services.resources.listDirectory");
            return resources.listDirectory(id, query, lifecycle.signal);
          },
          openDirectoryFile: (id, path) => {
            lifecycle.assertActive("services.resources.openDirectoryFile");
            return resources.openDirectoryFile(id, path, lifecycle.signal);
          },
          releaseDirectory: (id) => {
            lifecycle.assertActive("services.resources.releaseDirectory");
            return resources.releaseDirectory(id);
          },
          assets: createPluginAssets(manifest.id, lifecycle, resources),
          pick: (options) => {
            lifecycle.assertActive("services.resources.pick");
            return resources.pick(options, lifecycle.signal);
          },
          ...(permissions.has("library:read") || permissions.has("library:write")
            ? {
                openBook: (bookId: string) =>
                  scopedRead(bookId, "services.resources.openBook", (signal) => resources.openBook(bookId, signal)),
                openCover: (bookId: string) =>
                  scopedRead(bookId, "services.resources.openCover", (signal) => resources.openCover(bookId, signal)),
              }
            : {}),
          create: (options) => {
            lifecycle.assertActive("services.resources.create");
            return resources.create(options, lifecycle.signal);
          },
          stat: (id) => {
            lifecycle.assertActive("services.resources.stat");
            return resources.stat(id, lifecycle.signal);
          },
          read: (id, offset, length) => {
            lifecycle.assertActive("services.resources.read");
            return resources.read(id, offset, length, lifecycle.signal);
          },
          append: (id, offset, data) => {
            lifecycle.assertActive("services.resources.append");
            return resources.append(id, offset, data, lifecycle.signal);
          },
          commit: (id) => {
            lifecycle.assertActive("services.resources.commit");
            return resources.commit(id, lifecycle.signal);
          },
          save: (id, filename) => {
            lifecycle.assertActive("services.resources.save");
            return resources.save(id, filename, lifecycle.signal);
          },
          openAssociated: (id, options) => {
            lifecycle.assertActive("services.resources.openAssociated");
            return resources.openAssociated(id, callSignal(options));
          },
          release: (id) => {
            lifecycle.assertActive("services.resources.release");
            return resources.release(id);
          },
        },
        session: {
          operationAvailability: (input, options) => {
            lifecycle.assertActive("services.session.operationAvailability");
            const signal = callSignal(options);
            signal.throwIfAborted();
            const query = normalizeOperationAvailability(input);
            if (query.operation === "clipboard.writeText" || query.operation === "ui.openExternal") {
              const service = query.operation === "clipboard.writeText" ? "clipboard" : "network";
              if (!canUseHostService(service, permissions))
                return Promise.resolve(
                  operationAvailability(query, [
                    { kind: "permission", state: "unavailable", reason: `service:${service}-required` },
                  ]),
                );
              return lifecycle.read(
                "services.session.operationAvailability",
                () => checkOperationAvailability(query, signal),
                signal,
              );
            }
            if (query.operation === "resources.save" || query.operation === "resources.openAssociated") {
              return lifecycle.read(
                "services.session.operationAvailability",
                async () => operationAvailability(query, await resources.conditions(query, signal)),
                signal,
              );
            }
            if (query.operation === "schedules.control") {
              if (query.schedule.pluginId !== manifest.id)
                return Promise.resolve(
                  operationAvailability(query, [
                    {
                      kind: "permission",
                      state: "unavailable",
                      reason: "schedule-owner-required",
                      errorCode: "plugin/permission-denied",
                    },
                  ]),
                );
              return lifecycle.read(
                "services.session.operationAvailability",
                async () => operationAvailability(query, pluginSchedules.conditions(query.schedule)),
                signal,
              );
            }
            if (query.operation === "settings.refreshModelCatalog") {
              return lifecycle.read(
                "services.session.operationAvailability",
                async () =>
                  operationAvailability(query, settingsDomain.queries.modelCatalogRefreshConditions(query.provider)),
                signal,
              );
            }
            if (query.operation === "ui.commands.execute") {
              if (!permissions.has("library:write") || !commandAvailability)
                return Promise.resolve(
                  operationAvailability(query, [
                    { kind: "permission", state: "unavailable", reason: "library:write-required" },
                  ]),
                );
              const check = commandAvailability;
              return lifecycle.read(
                "services.session.operationAvailability",
                () => check(query.command, signal),
                signal,
              );
            }
            if (query.operation === "plugins.callService") {
              return lifecycle.read(
                "services.session.operationAvailability",
                async () => pluginServices.inspect(serviceParticipant(operationActor), query.serviceCall),
                signal,
              );
            }
            if (query.operation === "ui.exportFile") {
              return lifecycle.read(
                "services.session.operationAvailability",
                () => checkOperationAvailability(query, signal),
                signal,
              );
            }
            if (query.operation === "window.control") {
              return lifecycle.read(
                "services.session.operationAvailability",
                () => checkOperationAvailability(query, signal),
                signal,
              );
            }
            if (
              query.operation === "maintenance.requestBackup" ||
              query.operation === "maintenance.requestConnectionTest" ||
              query.operation === "diagnostics.requestReport" ||
              query.operation === "diagnostics.requestProjectionRepair"
            ) {
              if (query.operation.startsWith("diagnostics.") && !canUseHostService("diagnostics", permissions))
                return Promise.resolve(
                  operationAvailability(query, [
                    { kind: "permission", state: "unavailable", reason: "service:diagnostics-required" },
                  ]),
                );
              return lifecycle.read(
                "services.session.operationAvailability",
                () => checkOperationAvailability(query, signal),
                signal,
              );
            }
            if (query.operation === "diagnostics.verifyProjections") {
              if (!canUseHostService("diagnostics", permissions))
                return Promise.resolve(
                  operationAvailability(query, [
                    { kind: "permission", state: "unavailable", reason: "service:diagnostics-required" },
                  ]),
                );
              return lifecycle.read(
                "services.session.operationAvailability",
                () => checkOperationAvailability(query, signal),
                signal,
              );
            }
            if (query.operation === "maintenance.checkForUpdates") {
              if (!canUseHostService("network", permissions))
                return Promise.resolve(
                  operationAvailability(query, [
                    { kind: "permission", state: "unavailable", reason: "service:network-required" },
                  ]),
                );
              return lifecycle.read(
                "services.session.operationAvailability",
                () => checkOperationAvailability(query, signal),
                signal,
              );
            }
            if (query.operation === "sync.now" || query.operation === "sync.requestFlow") {
              if (!canUseHostService("sync", permissions))
                return Promise.resolve(
                  operationAvailability(query, [
                    { kind: "permission", state: "unavailable", reason: "service:sync-required" },
                  ]),
                );
              return lifecycle.read(
                "services.session.operationAvailability",
                () => checkOperationAvailability(query, signal),
                signal,
              );
            }
            if (query.operation !== "llm.infer") {
              const permission =
                query.operation === "library.text.prepare"
                  ? "library:write"
                  : query.operation === "memory.graph.generate"
                    ? "memory:write"
                    : "reading:write";
              if (!permissions.has(permission))
                return Promise.resolve(
                  operationAvailability(query, [
                    { kind: "permission", state: "unavailable", reason: `${permission}-required` },
                  ]),
                );
              if (query.operation === "memory.graph.generate" && !canUseHostService("llm", permissions))
                return Promise.resolve(
                  operationAvailability(query, [
                    { kind: "permission", state: "unavailable", reason: "service:llm-required" },
                  ]),
                );
              try {
                objectAccess.assertBook(query.bookId, "services.session.operationAvailability");
              } catch {
                return Promise.resolve(
                  operationAvailability(query, [
                    {
                      kind: "permission",
                      state: "unavailable",
                      reason: "book-scope-required",
                      errorCode: "plugin/object-access-denied",
                    },
                  ]),
                );
              }
              return scopedRead(
                query.bookId,
                "services.session.operationAvailability",
                (signal) =>
                  checkOperationAvailability(query, signal, {
                    textPreparation: owners.textTasks,
                    graphTasks: owners.graphTasks,
                  }),
                options,
              );
            }
            if (!canUseHostService("llm", permissions))
              return Promise.resolve(
                operationAvailability(query, [
                  { kind: "permission", state: "unavailable", reason: "service:llm-required" },
                ]),
              );
            return lifecycle.read(
              "services.session.operationAvailability",
              () => checkOperationAvailability(query, signal),
              signal,
            );
          },
          environment: async () => {
            lifecycle.assertActive("services.session.environment");
            return hostEnvironment.snapshot();
          },
          observeEnvironment: (handler) => track(() => ({ dispose: hostEnvironment.observe(handler) })),
        },
      },
    };

    if (objectAccess.restricted) {
      const rawSettings = ctx.domains.settings;
      const settingsTargetBook = (
        target: import("@read-aware/core").SettingsQueryTarget | import("@read-aware/core").SettingsTarget | undefined,
        operation: string,
      ): string | null => {
        if (!target || target.kind === "global") return null;
        if (target.kind !== "book") throw pluginObjectAccessDenied(operation);
        objectAccess.assertBook(target.bookId, operation);
        return target.bookId;
      };
      const sanitizeSettingsSnapshot = (
        snapshot: import("@read-aware/core").SettingsSnapshot,
        target: import("@read-aware/core").SettingsQueryTarget | undefined,
      ) => {
        if (!target || target.kind === "global") return { ...snapshot, overrides: [] };
        return {
          ...snapshot,
          overrides: snapshot.overrides.filter((override) => {
            objectAccess.assertReturnedBook(override.target.bookId, "settings.overrides");
            return true;
          }),
        };
      };
      const sanitizeSettingsUpdate = (
        result: import("@read-aware/core").SettingsUpdateResult,
        target: import("@read-aware/core").SettingsQueryTarget,
      ) => ({
        ...result,
        settings: sanitizeSettingsSnapshot(result.settings, target),
      });
      ctx.domains.settings = restrictSurface<PluginContext["domains"]["settings"]>(lifecycle, "domains.settings", {
        queries: {
          // Public model metadata carries no book object.
          modelCatalog: restricted.read(rawSettings.queries.modelCatalog),
          snapshot: restricted.read((query) => {
            const bookId = settingsTargetBook(query?.target, "settings.queries.snapshot");
            return bookId
              ? scopedRead(
                  bookId,
                  "settings.queries.snapshot",
                  () => rawSettings.queries.snapshot(query),
                  undefined,
                  (value) => sanitizeSettingsSnapshot(value, query?.target),
                )
              : lifecycle
                  .read("settings.queries.snapshot", () => rawSettings.queries.snapshot(query))
                  .then((value) => sanitizeSettingsSnapshot(value, query?.target));
          }),
          observe: restricted.observe((query, handler) => {
            const bookId = settingsTargetBook(query?.target, "settings.queries.observe");
            return () => ({
              dispose: settingsDomain.queries.observe(query, (event) => {
                try {
                  if (bookId) objectAccess.assertBook(bookId, "settings.queries.observe");
                  if (event.status === "ready") {
                    const snapshot = sanitizeSettingsSnapshot(event.snapshot, query?.target);
                    return handler(copyEventCause(event, { ...event, snapshot }));
                  } else return handler(event);
                } catch (error) {
                  log.debug("settings observation outside book grant", error);
                }
              }),
            });
          }),
          // Catalog entries carry no values, but a named book target is still an object reference.
          discover: restricted.read((query) => {
            const bookId = settingsTargetBook(query?.target, "settings.queries.discover");
            return bookId
              ? scopedRead(bookId, "settings.queries.discover", () => rawSettings.queries.discover(query))
              : rawSettings.queries.discover(query);
          }),
          // The unscoped branch is the unrestricted query, including its active-phase
          // rule for plugin-owned option providers.
          options: restricted.read((query) => {
            const bookId = settingsTargetBook(query?.target, "settings.queries.options");
            return bookId
              ? scopedRead(bookId, "settings.queries.options", (signal) =>
                  settingsDomain.queries.options(query, signal),
                )
              : rawSettings.queries.options(query);
          }),
          read: restricted.read((path, target) => {
            const bookId = settingsTargetBook(target, "settings.queries.read");
            return bookId
              ? scopedRead(
                  bookId,
                  "settings.queries.read",
                  () => rawSettings.queries.read(path, target),
                  undefined,
                  (value) =>
                    objectAccess.assertReturnedBook(
                      value.target.kind === "book" ? value.target.bookId : null,
                      "settings.queries.read",
                    ),
                )
              : lifecycle.read("settings.queries.read", () => rawSettings.queries.read(path, target));
          }),
        },
        commands: {
          refreshModelCatalog: rawSettings.commands.refreshModelCatalog
            ? restricted.command(rawSettings.commands.refreshModelCatalog)
            : restricted.absent,
          update: restricted.command(async (changes) => {
            const bookIds = new Set<string>();
            for (const change of changes) {
              const bookId = settingsTargetBook(change.target, "settings.commands.update");
              if (bookId) bookIds.add(bookId);
            }
            if (bookIds.size > 1) throw pluginObjectAccessDenied("settings.commands.update");
            const bookId = [...bookIds][0];
            return bookId
              ? scopedCommand(
                  bookId,
                  "settings.commands.update",
                  (signal) => settingsDomain.commands.update(changes, signal),
                  undefined,
                  true,
                  (result) => {
                    sanitizeSettingsSnapshot(result.settings, { kind: "book", bookId });
                  },
                ).then((result) => sanitizeSettingsUpdate(result, { kind: "book", bookId }))
              : rawSettings.commands
                  .update(changes)
                  .then((result) => sanitizeSettingsUpdate(result, { kind: "global" }));
          }),
          resetReading: restricted.command(async (request) => {
            if (request.target.kind === "all-books") throw pluginObjectAccessDenied("settings.commands.resetReading");
            const bookId = settingsTargetBook(request.target, "settings.commands.resetReading");
            return bookId
              ? scopedCommand(
                  bookId,
                  "settings.commands.resetReading",
                  (signal) => settingsDomain.commands.resetReading(request, signal),
                  undefined,
                  true,
                  (result) => {
                    sanitizeSettingsSnapshot(result.settings, { kind: "book", bookId });
                  },
                ).then((result) => sanitizeSettingsUpdate(result, { kind: "book", bookId }))
              : rawSettings.commands
                  .resetReading(request)
                  .then((result) => sanitizeSettingsUpdate(result, { kind: "global" }));
          }),
        },
        events: {
          subscribe: restricted.observe((handler, options) => () => ({
            dispose: settingsDomain.events.subscribe((event) => {
              if (options?.ignoreSelf && event.origin === selfOrigin) return;
              const changes = event.changes.flatMap((change) => {
                try {
                  if (change.target?.kind === "book") {
                    objectAccess.assertBook(change.target.bookId, "settings.events.subscribe");
                  } else if (change.target?.kind === "all-books") return [];
                  return [change];
                  // A change to a book outside the grant is withheld, not an error.
                } catch {
                  return [];
                }
              });
              if (changes.length) deliverSettingsEvent(handler, copyEventCause(event, { ...event, changes }));
            }),
          })),
        },
      });
    }

    // The registry already applied domain permissions. This layer only adapts
    // host-only details such as tracked subscriptions and virtual-book bindings.
    if (domain.library) {
      const library = domain.library;
      const commands = actorHostCommands(
        settingsDomain,
        true,
        !!library.commands,
        !!domain.reading?.commands,
        operationActor,
      );
      commandAvailability = commands.check;
      ctx.services.ui.commands = {
        observe: (handler) => track(() => ({ dispose: commands.observe(handler) })),
        list: async () => {
          lifecycle.assertActive("services.ui.commands.list");
          return commands.list(lifecycle.signal);
        },
        ...(library.commands
          ? {
              execute: (request: import("@read-aware/core").HostCommandRequest) => {
                lifecycle.assertActive("services.ui.commands.execute");
                return commands.execute(request, lifecycle.signal);
              },
            }
          : {}),
      };
      ctx.services.ui.workspace = {
        snapshot: async (query) => {
          lifecycle.assertActive("services.ui.workspace.snapshot");
          return workspace.snapshot(query);
        },
        observe: (query, handler) =>
          track(() => ({ dispose: workspace.observe(query, handler, undefined, operationActor) })),
        ...(library.commands
          ? {
              navigate: (target: import("@read-aware/core").WorkspaceTarget, expectedRevision?: number) => {
                lifecycle.assertActive("services.ui.workspace.navigate");
                return workspace.navigate(
                  target,
                  expectedRevision,
                  lifecycle.signal,
                  !!domain.reading?.commands,
                  undefined,
                  operationActor,
                );
              },
            }
          : {}),
      };
      if (objectAccess.restricted) {
        const scoped = scopePluginWorkspace(
          workspace,
          commands,
          objectAccess,
          lifecycle,
          {
            current: () => latestCurrent,
            observe: (handler) => {
              let initial = true;
              return readingRuntime.observe((snapshot) => {
                const source = initial ? stampEventCause({}, operationActor) : snapshot;
                initial = false;
                return handler(source);
              });
            },
          },
          !!library.commands,
          !!domain.reading?.commands,
          scopedWorkspaceState,
          operationActor,
        );
        commandAvailability = scoped.checkCommand;
        ctx.services.ui.commands = scoped.commands;
        ctx.services.ui.workspace = scoped.workspace;
      }
      ctx.domains.library = {
        queries: {
          ...library.queries,
          books: {
            ...library.queries.books,
            getImportTask: (taskId, waitMs, options) => importTasks.wait(taskId, waitMs, callSignal(options)),
            listImportTasks: async () => importTasks.list(),
            inspectResource: (id, options) =>
              lifecycle.read(
                "library.inspectResource",
                (signal) => inspectResourceBook(resources, id, signal),
                callSignal(options),
              ),
            getNavigationToc: (bookId, options) =>
              lifecycle.read(
                "library.getNavigationToc",
                (signal) => library.queries.books.getNavigationToc(bookId, signal),
                callSignal(options),
              ),
            listNavigationTargets: (input, options) =>
              lifecycle.read(
                "library.listNavigationTargets",
                (signal) => library.queries.books.listNavigationTargets(input, signal),
                callSignal(options),
              ),
            searchLocations: (input, options) =>
              lifecycle.read(
                "library.searchLocations",
                (signal) => library.queries.books.searchLocations(input, signal),
                callSignal(options),
              ),
            readRange: (input, options) =>
              lifecycle.read(
                "library.readRange",
                (signal) => library.queries.books.readRange(input, signal),
                callSignal(options),
              ),
            listReferences: (input, options) =>
              lifecycle.read(
                "library.listReferences",
                (signal) => library.queries.books.listReferences(input, signal),
                callSignal(options),
              ),
            listImages: (input, options) =>
              lifecycle.read(
                "library.listImages",
                (signal) => library.queries.books.listImages(input, signal),
                callSignal(options),
              ),
            openImageResource: (input) =>
              lifecycle.read("library.openImageResource", () =>
                openBookImageResource(resources, input, lifecycle.signal),
              ),
            readReference: (input, options) =>
              lifecycle.read(
                "library.readReference",
                (signal) => library.queries.books.readReference(input, signal),
                callSignal(options),
              ),
            searchText: (input, options) =>
              lifecycle.read(
                "library.searchText",
                (signal) => library.queries.books.searchText(input, signal),
                callSignal(options),
              ),
            getContentState: (bookId, options) =>
              lifecycle.read(
                "library.getContentState",
                (signal) => library.queries.books.getContentState(bookId, signal),
                callSignal(options),
              ),
            listTextTaskHistory: (bookId, query) =>
              lifecycle.read("library.textTaskHistory", () => library.queries.books.listTextTaskHistory(bookId, query)),
            listRemovalCleanup: library.queries.books.listRemovalCleanup,
          },
        },
        events: {
          subscribe: trackedOn(library.events.subscribe),
          observeInvalidation: (handler) => track(() => ({ dispose: library.events.observeInvalidation(handler) })),
          observeTextTask: (bookId, taskId, listener) =>
            track(() => ({ dispose: library.events.observeTextTask(bookId, taskId, listener) })),
          observeImportTask: (taskId, listener) =>
            track(() => ({ dispose: importTasks.observe(taskId, listener, operationActor) })),
          observeEnrichment: (bookId, listener) =>
            track(() => ({ dispose: library.events.observeEnrichment(bookId, listener) })),
          observeContentState: (bookId, listener) =>
            track(() => ({ dispose: library.events.observeContentState(bookId, listener) })),
        },
      };
      if (library.commands) {
        const commands = {
          books: {
            prepareText: (bookId: string, options?: import("@read-aware/core").BookTextPrepareOptions) =>
              library.commands!.books.prepareText(bookId, options),
            retryEnrichment: (bookId: string) => library.commands!.books.retryEnrichment(bookId, lifecycle.signal),
            mergeDuplicates: (input: import("@read-aware/core").BookMergeRequest) =>
              library.commands!.books.mergeDuplicates(input, lifecycle.signal),
            setTextTaskPriority: library.commands.books.setTextTaskPriority,
            pauseTextTask: library.commands.books.pauseTextTask,
            resumeTextTask: library.commands.books.resumeTextTask,
            cancelTextTask: library.commands.books.cancelTextTask,
            importBook: (input: { fileName: string; data: ArrayBuffer | Uint8Array }, options?: PluginCallOptions) =>
              library.commands!.books.importBook(input, callSignal(options)),
            importResource: (id: string, options?: PluginCallOptions) =>
              importResourceBook(resources, id, operationActor, callSignal(options)),
            startImport: (input: import("@read-aware/core").BookImportRequest, options?: PluginCallOptions) =>
              importTasks.start(input, callSignal(options), operationActor),
            cancelImportTask: async (id: string) => importTasks.cancel(id, operationActor),
            editMetadata: library.commands.books.editMetadata,
            setStarred: library.commands.books.setStarred,
            remove: library.commands.books.remove,
            removeMany: library.commands.books.removeMany,
            retryRemovalCleanup: library.commands.books.retryRemovalCleanup,
            addVirtualBook: async (
              input: Parameters<
                NonNullable<NonNullable<PluginContext["domains"]["library"]>["commands"]>["books"]["addVirtualBook"]
              >[0],
            ) => {
              if (
                !input ||
                typeof input.providerId !== "string" ||
                !input.providerId.trim() ||
                input.providerId.length > 256 ||
                typeof input.key !== "string" ||
                !input.key ||
                input.key.length > 8192 ||
                typeof input.title !== "string" ||
                (input.author !== undefined && typeof input.author !== "string")
              )
                throw new AppError("plugin/invalid-argument", "Invalid virtual book metadata");
              const binding = { pluginId: manifest.id, providerId: input.providerId, key: input.key };
              const metadata = { title: input.title, author: input.author };
              return lifecycle.storageWrite("library.addVirtualBook", () =>
                withVirtualBookBinding(binding, async () => {
                  lifecycle.assertActive("library.addVirtualBook");
                  const existingId = await afterLocalKVWrites(() => findVirtualBookId(binding));
                  if (existingId) {
                    const alive = await library.queries.books.get(existingId);
                    lifecycle.assertActive("library.addVirtualBook");
                    if (alive) {
                      if (alive.format !== "virtual")
                        throw new AppError("db/error", "Virtual binding points to a non-virtual book");
                      await library.commands!.books.updateVirtualBookTitle(existingId, metadata.title, metadata.author);
                      return { ...alive, title: metadata.title, author: metadata.author ?? alive.author };
                    }
                    await unbindVirtualBookDurably(existingId, binding);
                  }
                  lifecycle.assertActive("library.addVirtualBook");
                  return library.commands!.books.addVirtualBook({ ...metadata, binding });
                }),
              );
            },
            removeVirtualBook: async (
              input: Parameters<
                NonNullable<NonNullable<PluginContext["domains"]["library"]>["commands"]>["books"]["removeVirtualBook"]
              >[0],
            ) => {
              const binding = { pluginId: manifest.id, providerId: String(input.providerId), key: String(input.key) };
              const expectedBookId = input.expectedBookId;
              await lifecycle.storageWrite("library.removeVirtualBook", () =>
                withVirtualBookBinding(binding, async () => {
                  lifecycle.assertActive("library.removeVirtualBook");
                  await removeOwnedVirtualBook(binding, library.commands!.books.remove, expectedBookId);
                }),
              );
            },
            invalidateVirtualBook: (input: { providerId: string; key: string }) =>
              invalidateOwnedVirtualBook(
                {
                  pluginId: manifest.id,
                  providerId: String(input.providerId),
                  key: String(input.key),
                },
                library.queries.books.get,
                lifecycle.signal,
                operationActor,
              ),
          },
          collections: library.commands.collections,
        };
        ctx.domains.library.commands = guardMutationTree(
          commands,
          (operation) => lifecycle.assertActive(operation),
          "domains.library.commands",
        );
      }
      if (objectAccess.restricted) {
        const queryBooks = library.queries.books;
        const verifyBook = (operation: string) => (value: { id?: string } | null) => {
          if (value) objectAccess.assertReturnedBook(value.id, operation);
        };
        const verifyBookId = (operation: string) => (value: { bookId?: string } | null) => {
          if (value) objectAccess.assertReturnedBook(value.bookId, operation);
        };
        const commandPolicy = (
          commands: NonNullable<typeof library.commands>,
        ): RestrictedPolicy<NonNullable<PluginLibraryDomain["commands"]>> => {
          const commandBooks = commands.books;
          const verifyTask = (operation: string) => (value: { bookId?: string } | null) => {
            if (value) objectAccess.assertReturnedBook(value.bookId, operation);
          };
          return {
            books: {
              prepareText: restricted.command(async (bookId, options) => {
                const operation = "library.commands.books.prepareText";
                const fence = await objectAccess.beginBook(bookId, operation);
                const cancel = new AbortController();
                const signal = AbortSignal.any([
                  lifecycle.signal,
                  cancel.signal,
                  ...(fence.signal ? [fence.signal] : []),
                ]);
                let disposed = false;
                const access = {
                  signal,
                  isAllowed: () => !disposed && !signal.aborted,
                  dispose: () => {
                    if (!disposed) {
                      disposed = true;
                      fence.dispose();
                    }
                  },
                };
                try {
                  const task = await commandBooks.prepareText(bookId, options, access);
                  verifyTask(operation)(task);
                  await fence.assertUnchanged({ retain: true });
                  return task;
                } catch (error) {
                  cancel.abort(error);
                  access.dispose();
                  throw error;
                }
              }),
              retryEnrichment: restricted.command((bookId) =>
                scopedCommand(
                  bookId,
                  "library.commands.books.retryEnrichment",
                  (signal) => commandBooks.retryEnrichment(bookId, signal),
                  undefined,
                  true,
                  (value) =>
                    objectAccess.assertReturnedBook(value.snapshot.bookId, "library.commands.books.retryEnrichment"),
                ),
              ),
              mergeDuplicates: restricted.deny,
              setTextTaskPriority: restricted.command((bookId, taskId, priority) =>
                scopedCommand(
                  bookId,
                  "library.commands.books.setTextTaskPriority",
                  () => commandBooks.setTextTaskPriority(bookId, taskId, priority),
                  undefined,
                  true,
                  verifyTask("library.commands.books.setTextTaskPriority"),
                ),
              ),
              pauseTextTask: restricted.command((bookId, taskId) =>
                scopedCommand(
                  bookId,
                  "library.commands.books.pauseTextTask",
                  () => commandBooks.pauseTextTask(bookId, taskId),
                  undefined,
                  true,
                  verifyTask("library.commands.books.pauseTextTask"),
                ),
              ),
              resumeTextTask: restricted.command((bookId, taskId) =>
                scopedCommand(
                  bookId,
                  "library.commands.books.resumeTextTask",
                  () => commandBooks.resumeTextTask(bookId, taskId),
                  undefined,
                  true,
                  verifyTask("library.commands.books.resumeTextTask"),
                ),
              ),
              cancelTextTask: restricted.command((bookId, taskId) =>
                scopedCommand(
                  bookId,
                  "library.commands.books.cancelTextTask",
                  () => commandBooks.cancelTextTask(bookId, taskId),
                  undefined,
                  true,
                  verifyTask("library.commands.books.cancelTextTask"),
                ),
              ),
              importBook: restricted.deny,
              importResource: restricted.deny,
              startImport: restricted.deny,
              cancelImportTask: restricted.deny,
              editMetadata: restricted.command((bookId, patch) =>
                scopedCommand(
                  bookId,
                  "library.commands.books.editMetadata",
                  () => commandBooks.editMetadata(bookId, patch),
                  undefined,
                  false,
                ),
              ),
              setStarred: restricted.command((bookId, starred) =>
                scopedCommand(
                  bookId,
                  "library.commands.books.setStarred",
                  () => commandBooks.setStarred(bookId, starred),
                  undefined,
                  false,
                ),
              ),
              remove: restricted.command((bookId) =>
                scopedCommand(
                  bookId,
                  "library.commands.books.remove",
                  () => commandBooks.remove(bookId),
                  undefined,
                  false,
                ),
              ),
              removeMany: restricted.deny,
              retryRemovalCleanup: restricted.deny,
              addVirtualBook: restricted.deny,
              removeVirtualBook: restricted.deny,
              invalidateVirtualBook: restricted.deny,
            },
            collections: {
              create: restricted.deny,
              rename: restricted.deny,
              remove: restricted.deny,
              assignBooks: restricted.deny,
            },
          };
        };
        ctx.domains.library = restrictSurface<PluginLibraryDomain>(lifecycle, "domains.library", {
          queries: {
            books: {
              list: restricted.read(async () => {
                const operation = "library.books.list";
                lifecycle.assertActive(operation);
                const fence =
                  grantedBookAccess.mode === "book"
                    ? await objectAccess.beginBook(grantedBookAccess.bookId, operation)
                    : await objectAccess.beginCurrent(operation);
                try {
                  const books = await lifecycle.read(operation, () => queryBooks.list(), fence.signal);
                  const result = objectAccess.filterBooks(books, latestCurrent);
                  await fence.assertUnchanged();
                  return result;
                } catch (error) {
                  fence.dispose();
                  throw error;
                }
              }),
              // Supported import formats describe the host, not a library object.
              listFormats: restricted.read(() =>
                lifecycle.read("library.books.listFormats", () => queryBooks.listFormats()),
              ),
              inspectResource: restricted.deny,
              listDuplicates: restricted.deny,
              previewMerge: restricted.deny,
              resolveId: restricted.deny,
              listRemovalCleanup: restricted.deny,
              get: restricted.read((bookId) =>
                scopedRead(
                  bookId,
                  "library.books.get",
                  () => queryBooks.get(bookId),
                  undefined,
                  verifyBook("library.books.get"),
                ),
              ),
              getToc: restricted.read((bookId) =>
                scopedRead(bookId, "library.books.getToc", () => queryBooks.getToc(bookId)),
              ),
              getTextState: restricted.read((bookId) =>
                scopedRead(
                  bookId,
                  "library.books.getTextState",
                  () => queryBooks.getTextState(bookId),
                  undefined,
                  verifyBookId("library.books.getTextState"),
                ),
              ),
              getEnrichment: restricted.read((bookId) =>
                scopedRead(
                  bookId,
                  "library.books.getEnrichment",
                  () => queryBooks.getEnrichment(bookId),
                  undefined,
                  verifyBookId("library.books.getEnrichment"),
                ),
              ),
              getContentState: restricted.read((bookId, options) =>
                scopedRead(
                  bookId,
                  "library.books.getContentState",
                  (signal) => queryBooks.getContentState(bookId, signal),
                  options,
                  verifyBookId("library.books.getContentState"),
                ),
              ),
              listTextTaskHistory: restricted.read((bookId, query) =>
                scopedRead(
                  bookId,
                  "library.books.listTextTaskHistory",
                  () => queryBooks.listTextTaskHistory(bookId, query),
                  undefined,
                  (page) => {
                    for (const item of page.items)
                      objectAccess.assertReturnedBook(item.snapshot.bookId, "library.books.listTextTaskHistory");
                  },
                ),
              ),
              getTextTask: restricted.read((bookId, taskId) =>
                scopedRead(
                  bookId,
                  "library.books.getTextTask",
                  () => queryBooks.getTextTask(bookId, taskId),
                  undefined,
                  verifyBookId("library.books.getTextTask"),
                ),
              ),
              listTextTasks: restricted.read((bookId) =>
                scopedRead(
                  bookId,
                  "library.books.listTextTasks",
                  () => queryBooks.listTextTasks(bookId),
                  undefined,
                  (tasks) => {
                    for (const task of tasks)
                      objectAccess.assertReturnedBook(task.bookId, "library.books.listTextTasks");
                  },
                ),
              ),
              getImportTask: restricted.deny,
              listImportTasks: restricted.deny,
              getChapterText: restricted.read((bookId, chapterIndex) =>
                scopedRead(bookId, "library.books.getChapterText", () =>
                  queryBooks.getChapterText(bookId, chapterIndex),
                ),
              ),
              getNavigationToc: restricted.read((bookId, options) =>
                scopedRead(
                  bookId,
                  "library.books.getNavigationToc",
                  (signal) => queryBooks.getNavigationToc(bookId, signal),
                  options,
                  verifyBookId("library.books.getNavigationToc"),
                ),
              ),
              listNavigationTargets: restricted.read((input, options) =>
                scopedRead(
                  input.bookId,
                  "library.books.listNavigationTargets",
                  (signal) => queryBooks.listNavigationTargets(input, signal),
                  options,
                  verifyBookId("library.books.listNavigationTargets"),
                ),
              ),
              searchLocations: restricted.read((input, options) =>
                scopedRead(
                  input.bookId,
                  "library.books.searchLocations",
                  (signal) => queryBooks.searchLocations(input, signal),
                  options,
                  verifyBookId("library.books.searchLocations"),
                ),
              ),
              readRange: restricted.read((input, options) =>
                scopedRead(
                  input.range.bookId,
                  "library.books.readRange",
                  (signal) => queryBooks.readRange(input, signal),
                  options,
                  (value) => objectAccess.assertReturnedBook(value.range.bookId, "library.books.readRange"),
                ),
              ),
              listReferences: restricted.read((input, options) =>
                scopedRead(
                  input.bookId,
                  "library.books.listReferences",
                  (signal) => queryBooks.listReferences(input, signal),
                  options,
                  verifyBookId("library.books.listReferences"),
                ),
              ),
              listImages: restricted.read((input, options) =>
                scopedRead(
                  input.bookId,
                  "library.books.listImages",
                  (signal) => queryBooks.listImages(input, signal),
                  options,
                  verifyBookId("library.books.listImages"),
                ),
              ),
              openImageResource: restricted.read((input) =>
                scopedRead(
                  input.image.bookId,
                  "library.books.openImageResource",
                  (signal) => openBookImageResource(resources, input, signal),
                  undefined,
                  (value) =>
                    objectAccess.assertReturnedBook(value.image.image.bookId, "library.books.openImageResource"),
                ),
              ),
              readReference: restricted.read((input, options) =>
                scopedRead(
                  input.reference.bookId,
                  "library.books.readReference",
                  (signal) => queryBooks.readReference(input, signal),
                  options,
                  (value) => objectAccess.assertReturnedBook(value.reference.bookId, "library.books.readReference"),
                ),
              ),
              searchText: restricted.read((input, options) => {
                if (!input?.bookId) throw pluginObjectAccessDenied("library.books.searchText");
                return scopedRead(
                  input.bookId,
                  "library.books.searchText",
                  (signal) => queryBooks.searchText(input, signal),
                  options,
                  (hits) => {
                    for (const hit of hits) objectAccess.assertReturnedBook(hit.bookId, "library.books.searchText");
                  },
                );
              }),
            },
            collections: {
              list: restricted.deny,
              booksIn: restricted.deny,
            },
          },
          events: {
            subscribe: restricted.deny,
            observeInvalidation: restricted.deny,
            observeImportTask: restricted.deny,
            observeTextTask: restricted.observe((bookId, taskId, listener) => {
              objectAccess.assertBook(bookId, "library.events.observeTextTask");
              return () => ({
                dispose: library.events.observeTextTask(bookId, taskId, (snapshot) => {
                  try {
                    objectAccess.assertBook(bookId, "library.events.observeTextTask");
                    objectAccess.assertReturnedBook(snapshot.bookId, "library.events.observeTextTask");
                    return listener(snapshot);
                  } catch (error) {
                    log.debug("library text task outside book grant", error);
                  }
                }),
              });
            }),
            observeEnrichment: restricted.observe((bookId, listener) => {
              objectAccess.assertBook(bookId, "library.events.observeEnrichment");
              return () => ({
                dispose: library.events.observeEnrichment(bookId, (event) => {
                  try {
                    objectAccess.assertBook(bookId, "library.events.observeEnrichment");
                    if (event.status === "ready")
                      objectAccess.assertReturnedBook(event.snapshot.bookId, "library.events.observeEnrichment");
                    return listener(event);
                  } catch (error) {
                    log.debug("library enrichment outside book grant", error);
                  }
                }),
              });
            }),
            observeContentState: restricted.observe((bookId, listener) => {
              objectAccess.assertBook(bookId, "library.events.observeContentState");
              return () => ({
                dispose: library.events.observeContentState(bookId, (event) => {
                  try {
                    objectAccess.assertBook(bookId, "library.events.observeContentState");
                    if (event.status === "ready")
                      objectAccess.assertReturnedBook(event.snapshot.bookId, "library.events.observeContentState");
                    return listener(event);
                  } catch (error) {
                    log.debug("library content state outside book grant", error);
                  }
                }),
              });
            }),
          },
          commands: library.commands ? commandPolicy(library.commands) : restricted.absent,
        });
      }
    }

    if (domain.reading) {
      const reading = domain.reading;
      ctx.services.ui.reader = {
        image: {
          ...(reading.commands && domain.library
            ? {
                open: (
                  query: import("@read-aware/core").BookImageQuery,
                  guard?: import("@read-aware/core").ReadingSessionGuard,
                ) => {
                  lifecycle.assertActive("services.ui.reader.image.open");
                  return lifecycle.read("services.ui.reader.image.open", () =>
                    readerImageOpen.open(
                      query,
                      (input, signal) => readBookImage(input, signal),
                      lifecycle.signal,
                      guard,
                      operationActor,
                    ),
                  );
                },
              }
            : {}),
          snapshot: async () => {
            lifecycle.assertActive("services.ui.reader.image.snapshot");
            return readerImage.snapshot();
          },
          observe: (handler) => track(() => ({ dispose: readerImage.observe(handler, operationActor) })),
          ...(reading.commands
            ? {
                control: (request: import("@read-aware/core").ReaderImageRequest) => {
                  lifecycle.assertActive("services.ui.reader.image.control");
                  return lifecycle.read("services.ui.reader.image.control", () =>
                    readerImage.control(request, lifecycle.signal, operationActor),
                  );
                },
              }
            : {}),
        },
        snapshot: async () => {
          lifecycle.assertActive("services.ui.reader.snapshot");
          return readerPanels.snapshot();
        },
        observe: (handler) => track(() => ({ dispose: readerPanels.observe(handler, operationActor) })),
        ...(reading.commands
          ? {
              setPanel: (
                panel: import("@read-aware/core").ReaderPanel,
                open: boolean,
                guard?: import("@read-aware/core").ReadingSessionGuard,
              ) => {
                lifecycle.assertActive("services.ui.reader.setPanel");
                return readerPanels.setPanel(panel, open, lifecycle.signal, guard, operationActor);
              },
              setWidth: (
                panel: import("@read-aware/core").ResizableReaderPanel,
                width: number,
                guard?: import("@read-aware/core").ReadingSessionGuard,
              ) => {
                lifecycle.assertActive("services.ui.reader.setWidth");
                return readerPanels.setWidth(panel, width, lifecycle.signal, guard, operationActor);
              },
              focus: (
                target: import("@read-aware/core").ReaderFocusTarget,
                guard?: import("@read-aware/core").ReadingSessionGuard,
              ) => {
                lifecycle.assertActive("services.ui.reader.focus");
                return readerFocus.focus(target, lifecycle.signal, guard, operationActor);
              },
            }
          : {}),
        ...(reading.commands && domain.library
          ? {
              previewReference: (
                query: import("@read-aware/core").BookReferenceQuery,
                guard?: import("@read-aware/core").ReadingSessionGuard,
              ) => {
                lifecycle.assertActive("services.ui.reader.previewReference");
                return lifecycle.read("reader.previewReference", () =>
                  readerReferencePreview.open(
                    referencePreviewOwner,
                    query,
                    (input, signal) => domain.library!.queries.books.readReference(input, signal),
                    lifecycle.signal,
                    guard,
                  ),
                );
              },
              closeReferencePreview: (id: string) => {
                lifecycle.assertActive("services.ui.reader.closeReferencePreview");
                return lifecycle.read("reader.closeReferencePreview", () =>
                  readerReferencePreview.close(referencePreviewOwner, id, lifecycle.signal),
                );
              },
            }
          : {}),
      };
      if (objectAccess.restricted) {
        const rawReader = ctx.services.ui.reader;
        if (rawReader) {
          const rawImage = rawReader.image;
          ctx.services.ui.reader = {
            image: rawImage
              ? {
                  snapshot: async () => {
                    const value = await scopedCurrentRead("services.ui.reader.image.snapshot", async () =>
                      rawImage.snapshot(),
                    );
                    if (value) objectAccess.assertReturnedBook(value.bookId, "services.ui.reader.image.snapshot");
                    return value;
                  },
                  observe: (handler) => {
                    objectAccess.assertBook(latestCurrent.bookId ?? "", "services.ui.reader.image.observe");
                    return track(() =>
                      rawImage.observe((value, source) => {
                        try {
                          if (value) objectAccess.assertReturnedBook(value.bookId, "services.ui.reader.image.observe");
                        } catch (error) {
                          log.debug("reader image outside book grant", error);
                          return;
                        }
                        return handler(value, source);
                      }),
                    );
                  },
                  ...(rawImage.control
                    ? {
                        control: (request: import("@read-aware/core").ReaderImageRequest) =>
                          scopedCurrentCommand(
                            "services.ui.reader.image.control",
                            (signal) => readerImage.control(request, signal, operationActor),
                            undefined,
                            true,
                            (value) => {
                              if (value.status === "updated")
                                objectAccess.assertReturnedBook(
                                  value.snapshot.bookId,
                                  "services.ui.reader.image.control",
                                );
                            },
                          ),
                      }
                    : {}),
                  ...(rawImage.open
                    ? {
                        open: (
                          query: import("@read-aware/core").BookImageQuery,
                          guard?: import("@read-aware/core").ReadingSessionGuard,
                        ) =>
                          scopedRead(
                            query.image.bookId,
                            "services.ui.reader.image.open",
                            (signal) =>
                              readerImageOpen.open(
                                query,
                                (input, readSignal) => readBookImage(input, readSignal),
                                signal,
                                guard,
                                operationActor,
                              ),
                            undefined,
                            (value) => {
                              if (value.status === "opened")
                                objectAccess.assertReturnedBook(value.snapshot.bookId, "services.ui.reader.image.open");
                            },
                          ),
                      }
                    : {}),
                }
              : undefined,
            snapshot: async () => {
              const value = await scopedCurrentRead("services.ui.reader.snapshot", async () => rawReader.snapshot());
              if (value) objectAccess.assertReturnedBook(value.bookId, "services.ui.reader.snapshot");
              return value;
            },
            observe: (handler) => {
              objectAccess.assertBook(latestCurrent.bookId ?? "", "services.ui.reader.observe");
              return track(() =>
                rawReader.observe((value, source) => {
                  try {
                    if (value) objectAccess.assertReturnedBook(value.bookId, "services.ui.reader.observe");
                  } catch (error) {
                    log.debug("reader panels outside book grant", error);
                    return;
                  }
                  return handler(value, source);
                }),
              );
            },
            ...(rawReader.setPanel
              ? {
                  setPanel: (
                    panel: import("@read-aware/core").ReaderPanel,
                    open: boolean,
                    guard?: import("@read-aware/core").ReadingSessionGuard,
                  ) =>
                    scopedCurrentCommand(
                      "services.ui.reader.setPanel",
                      (signal) => readerPanels.setPanel(panel, open, signal, guard, operationActor),
                      undefined,
                      true,
                      (value) => objectAccess.assertReturnedBook(value.snapshot.bookId, "services.ui.reader.setPanel"),
                    ),
                }
              : {}),
            ...(rawReader.setWidth
              ? {
                  setWidth: (
                    panel: import("@read-aware/core").ResizableReaderPanel,
                    width: number,
                    guard?: import("@read-aware/core").ReadingSessionGuard,
                  ) =>
                    scopedCurrentCommand(
                      "services.ui.reader.setWidth",
                      (signal) => readerPanels.setWidth(panel, width, signal, guard, operationActor),
                      undefined,
                      true,
                      (value) => objectAccess.assertReturnedBook(value.snapshot.bookId, "services.ui.reader.setWidth"),
                    ),
                }
              : {}),
            ...(rawReader.focus
              ? {
                  focus: (
                    target: import("@read-aware/core").ReaderFocusTarget,
                    guard?: import("@read-aware/core").ReadingSessionGuard,
                  ) =>
                    scopedCurrentCommand(
                      "services.ui.reader.focus",
                      (signal) => readerFocus.focus(target, signal, guard, operationActor),
                      undefined,
                      true,
                      (value) => objectAccess.assertReturnedBook(value.bookId, "services.ui.reader.focus"),
                    ),
                }
              : {}),
            ...(rawReader.previewReference && domain.library
              ? {
                  previewReference: (
                    query: import("@read-aware/core").BookReferenceQuery,
                    guard?: import("@read-aware/core").ReadingSessionGuard,
                  ) =>
                    scopedRead(
                      query.reference.bookId,
                      "services.ui.reader.previewReference",
                      (signal) =>
                        readerReferencePreview.open(
                          referencePreviewOwner,
                          query,
                          (input, readSignal) => domain.library!.queries.books.readReference(input, readSignal),
                          signal,
                          guard,
                        ),
                      undefined,
                      (value) => {
                        objectAccess.assertReturnedBook(
                          value.preview.reference.bookId,
                          "services.ui.reader.previewReference",
                        );
                        if (value.preview.location)
                          objectAccess.assertReturnedBook(
                            value.preview.location.bookId,
                            "services.ui.reader.previewReference",
                          );
                      },
                    ),
                }
              : {}),
            ...(rawReader.closeReferencePreview
              ? {
                  closeReferencePreview: (id: string) =>
                    scopedCurrentCommand(
                      "services.ui.reader.closeReferencePreview",
                      (signal) => readerReferencePreview.close(referencePreviewOwner, id, signal),
                      undefined,
                      true,
                    ),
                }
              : {}),
          };
        }
      }
      ctx.domains.reading = {
        queries: reading.queries,
        events: {
          subscribe: trackedOn(reading.events.subscribe),
          observeSession: (handler) => track(() => ({ dispose: reading.events.observeSession(handler) })),
          observeEmphasis: (handler) => track(() => ({ dispose: reading.events.observeEmphasis(handler) })),
          observeTime: (query, handler) => track(() => ({ dispose: reading.events.observeTime(query, handler) })),
        },
      };
      if (reading.commands) {
        ctx.domains.reading.commands = guardMutationTree(
          {
            setFinished: reading.commands.setFinished,
            putEmphasis: (
              input: import("@read-aware/core").ReadingEmphasisWrite,
              guard?: import("@read-aware/core").ReadingSessionGuard,
              options?: PluginCallOptions,
            ) => reading.commands!.putEmphasis(input, callSignal(options), guard),
            removeEmphasis: (
              input: import("@read-aware/core").ReadingEmphasisRef,
              guard?: import("@read-aware/core").ReadingSessionGuard,
              options?: PluginCallOptions,
            ) => reading.commands!.removeEmphasis(input, callSignal(options), guard),
            selectRange: (
              range: import("@read-aware/core").BookTextRange,
              guard?: import("@read-aware/core").ReadingSessionGuard,
              options?: PluginCallOptions,
            ) => reading.commands!.selectRange(range, callSignal(options), guard),
            clearSelection: (
              expectedId: string,
              guard?: import("@read-aware/core").ReadingSessionGuard,
              options?: PluginCallOptions,
            ) => reading.commands!.clearSelection(expectedId, callSignal(options), guard),
            openBook: (bookId: string, options?: PluginCallOptions) =>
              reading.commands!.openBook(bookId, callSignal(options)),
            goTo: (target: import("@read-aware/core").ReadingTarget, options?: PluginCallOptions) =>
              reading.commands!.goTo(target, callSignal(options)),
            back: (guard?: import("@read-aware/core").ReadingSessionGuard, options?: PluginCallOptions) =>
              reading.commands!.back(callSignal(options), guard),
            forward: (guard?: import("@read-aware/core").ReadingSessionGuard, options?: PluginCallOptions) =>
              reading.commands!.forward(callSignal(options), guard),
            step: (
              direction: import("@read-aware/core").ReadingStep,
              guard?: import("@read-aware/core").ReadingSessionGuard,
              options?: PluginCallOptions,
            ) => reading.commands!.step(direction, callSignal(options), guard),
            reload: (guard?: import("@read-aware/core").ReadingSessionGuard, options?: PluginCallOptions) =>
              reading.commands!.reload(callSignal(options), guard),
            close: (guard?: import("@read-aware/core").ReadingSessionGuard, options?: PluginCallOptions) =>
              reading.commands!.close(callSignal(options), guard),
            controlPlayback: (
              action: "start" | "stop",
              guard?: import("@read-aware/core").ReadingSessionGuard,
              options?: PluginCallOptions,
            ) => reading.commands!.controlPlayback(action, callSignal(options), guard),
            configureMode: (
              input: import("@read-aware/core").ReadingModeConfiguration,
              guard?: import("@read-aware/core").ReadingSessionGuard,
              options?: PluginCallOptions,
            ) => reading.commands!.configureMode(input, callSignal(options), guard),
            setControls: (
              visible: boolean,
              guard?: import("@read-aware/core").ReadingSessionGuard,
              options?: PluginCallOptions,
            ) => reading.commands!.setControls(visible, callSignal(options), guard),
            returnToMode: (guard?: import("@read-aware/core").ReadingSessionGuard, options?: PluginCallOptions) =>
              reading.commands!.returnToMode(callSignal(options), guard),
            stepMode: (
              direction: "next" | "previous",
              guard?: import("@read-aware/core").ReadingSessionGuard,
              options?: PluginCallOptions,
            ) => reading.commands!.stepMode(direction, callSignal(options), guard),
          },
          (operation) => lifecycle.assertActive(operation),
          "domains.reading.commands",
        );
      }
      if (objectAccess.restricted) {
        const rawQueries = reading.queries;
        const verifySession = (session: import("@read-aware/core").ReadingSessionSnapshot): void => {
          objectAccess.assertReturnedBook(session.bookId, "reading.queries.session");
          if (session.location) objectAccess.assertReturnedBook(session.location.bookId, "reading.queries.session");
          if (session.selection?.range)
            objectAccess.assertReturnedBook(session.selection.range.bookId, "reading.queries.session");
        };
        const commandPolicy = (
          rawCommands: NonNullable<typeof reading.commands>,
        ): RestrictedPolicy<NonNullable<PluginReadingDomain["commands"]>> => {
          const verifyNavigation =
            (operation: string) =>
            (value: import("@read-aware/core").ReadingNavigationReceipt): void => {
              objectAccess.assertReturnedBook(value.location.bookId, operation);
            };
          const verifyModeReceipt =
            (operation: string) =>
            (value: import("@read-aware/core").ReadingModeReceipt): void => {
              if (value.mode.position) objectAccess.assertReturnedBook(value.mode.position.location.bookId, operation);
            };
          return {
            putEmphasis: restricted.command((input, guard, options) => {
              const bookId = input?.ranges?.[0]?.bookId;
              if (!bookId || input.ranges.some((range) => range.bookId !== bookId))
                throw pluginObjectAccessDenied("reading.commands.putEmphasis");
              return scopedCommand(
                bookId,
                "reading.commands.putEmphasis",
                (signal) => rawCommands.putEmphasis(input, signal, guard),
                options,
                true,
                (value) => objectAccess.assertReturnedBook(value.emphasis.bookId, "reading.commands.putEmphasis"),
              );
            }),
            removeEmphasis: restricted.command((input, guard, options) =>
              scopedCurrentCommand(
                "reading.commands.removeEmphasis",
                (signal) => rawCommands.removeEmphasis(input, signal, guard),
                options,
                true,
              ),
            ),
            selectRange: restricted.command((range, guard, options) =>
              scopedCommand(
                range.bookId,
                "reading.commands.selectRange",
                (signal) => rawCommands.selectRange(range, signal, guard),
                options,
                true,
                (value) => {
                  if (value.selection?.range)
                    objectAccess.assertReturnedBook(value.selection.range.bookId, "reading.commands.selectRange");
                },
              ),
            ),
            clearSelection: restricted.command((expectedId, guard, options) =>
              scopedCurrentCommand(
                "reading.commands.clearSelection",
                (signal) => rawCommands.clearSelection(expectedId, signal, guard),
                options,
                true,
                (value) => {
                  if (value.selection?.range)
                    objectAccess.assertReturnedBook(value.selection.range.bookId, "reading.commands.clearSelection");
                },
              ),
            ),
            setControls: restricted.command((visible, guard, options) =>
              scopedCurrentCommand(
                "reading.commands.setControls",
                (signal) => rawCommands.setControls(visible, signal, guard),
                options,
              ),
            ),
            setFinished: restricted.command((bookId, finished) =>
              scopedCommand(
                bookId,
                "reading.commands.setFinished",
                () => rawCommands.setFinished(bookId, finished),
                undefined,
                false,
              ),
            ),
            openBook: restricted.command((bookId, options) =>
              scopedCommand(
                bookId,
                "reading.commands.openBook",
                (signal) => rawCommands.openBook(bookId, signal),
                options,
                true,
                verifyNavigation("reading.commands.openBook"),
                { allowSessionChange: true },
              ),
            ),
            goTo: restricted.command((target, options) => {
              if (target?.bookId)
                return scopedCommand(
                  target.bookId,
                  "reading.commands.goTo",
                  (signal) => rawCommands.goTo(target, signal),
                  options,
                  true,
                  verifyNavigation("reading.commands.goTo"),
                );
              return scopedCurrentCommand(
                "reading.commands.goTo",
                (signal) => rawCommands.goTo(target, signal),
                options,
                true,
                verifyNavigation("reading.commands.goTo"),
              );
            }),
            back: restricted.command((guard, options) =>
              scopedCurrentCommand(
                "reading.commands.back",
                (signal) => rawCommands.back(signal, guard),
                options,
                true,
                verifyNavigation("reading.commands.back"),
              ),
            ),
            forward: restricted.command((guard, options) =>
              scopedCurrentCommand(
                "reading.commands.forward",
                (signal) => rawCommands.forward(signal, guard),
                options,
                true,
                verifyNavigation("reading.commands.forward"),
              ),
            ),
            step: restricted.command((direction, guard, options) =>
              scopedCurrentCommand(
                "reading.commands.step",
                (signal) => rawCommands.step(direction, signal, guard),
                options,
                true,
                verifyNavigation("reading.commands.step"),
              ),
            ),
            reload: restricted.command((guard, options) =>
              scopedCurrentCommand(
                "reading.commands.reload",
                (signal) => rawCommands.reload(signal, guard),
                options,
                true,
                verifyNavigation("reading.commands.reload"),
                { allowSessionChange: true },
              ),
            ),
            close: restricted.command((guard, options) =>
              scopedCurrentCommand(
                "reading.commands.close",
                (signal) => rawCommands.close(signal, guard),
                options,
                true,
                undefined,
                { allowClose: true },
              ),
            ),
            controlPlayback: restricted.command((action, guard, options) =>
              scopedCurrentCommand(
                "reading.commands.controlPlayback",
                (signal) => rawCommands.controlPlayback(action, signal, guard),
                options,
              ),
            ),
            configureMode: restricted.command((input, guard, options) =>
              scopedCurrentCommand(
                "reading.commands.configureMode",
                (signal) => rawCommands.configureMode(input, signal, guard),
                options,
                true,
                verifyModeReceipt("reading.commands.configureMode"),
              ),
            ),
            returnToMode: restricted.command((guard, options) =>
              scopedCurrentCommand(
                "reading.commands.returnToMode",
                (signal) => rawCommands.returnToMode(signal, guard),
                options,
                true,
                verifyNavigation("reading.commands.returnToMode"),
              ),
            ),
            stepMode: restricted.command((direction, guard, options) =>
              scopedCurrentCommand(
                "reading.commands.stepMode",
                (signal) => rawCommands.stepMode(direction, signal, guard),
                options,
                true,
                verifyModeReceipt("reading.commands.stepMode"),
              ),
            ),
          };
        };
        ctx.domains.reading = restrictSurface<PluginReadingDomain>(lifecycle, "domains.reading", {
          queries: {
            emphasis: restricted.read(() =>
              scopedCurrentRead(
                "reading.queries.emphasis",
                () => rawQueries.emphasis(),
                undefined,
                (emphasis) => {
                  for (const item of emphasis) objectAccess.assertReturnedBook(item.bookId, "reading.queries.emphasis");
                },
              ),
            ),
            session: restricted.read(() =>
              scopedCurrentRead("reading.queries.session", () => rawQueries.session(), undefined, verifySession),
            ),
            stats: {
              time: restricted.read((query) => {
                if (!query?.bookId) throw pluginObjectAccessDenied("reading.queries.stats.time");
                if (query.after && query.after.bookId !== query.bookId)
                  throw pluginObjectAccessDenied("reading.queries.stats.time");
                return scopedRead(
                  query.bookId,
                  "reading.queries.stats.time",
                  () => rawQueries.stats.time(query),
                  undefined,
                  (value) => {
                    objectAccess.assertReturnedBook(value.bookId, "reading.queries.stats.time");
                    if (value.nextCursor)
                      objectAccess.assertReturnedBook(value.nextCursor.bookId, "reading.queries.stats.time");
                    for (const item of value.pending)
                      objectAccess.assertReturnedBook(item.bookId, "reading.queries.stats.time");
                  },
                );
              }),
              insights: restricted.read((query) => {
                if (!query?.bookId) throw pluginObjectAccessDenied("reading.queries.stats.insights");
                return scopedRead(
                  query.bookId,
                  "reading.queries.stats.insights",
                  () => rawQueries.stats.insights(query),
                  undefined,
                  (value) => {
                    objectAccess.assertReturnedBook(value.bookId, "reading.queries.stats.insights");
                    if (value.achievements.mostReadBookId)
                      objectAccess.assertReturnedBook(
                        value.achievements.mostReadBookId,
                        "reading.queries.stats.insights",
                      );
                  },
                );
              }),
              forBook: restricted.read((bookId) =>
                scopedRead(
                  bookId,
                  "reading.queries.stats.forBook",
                  () => rawQueries.stats.forBook(bookId),
                  undefined,
                  (value) => {
                    if (value) objectAccess.assertReturnedBook(value.bookId, "reading.queries.stats.forBook");
                  },
                ),
              ),
              list: restricted.deny,
              overview: restricted.deny,
            },
          },
          events: {
            subscribe: restricted.deny,
            observeSession: restricted.observe((handler) => {
              objectAccess.assertBook(latestCurrent.bookId ?? "", "reading.events.observeSession");
              return () => ({
                dispose: reading.events.observeSession((snapshot) => {
                  try {
                    verifySession(snapshot);
                  } catch (error) {
                    log.debug("reading session outside book grant", error);
                    return;
                  }
                  return handler(snapshot);
                }),
              });
            }),
            observeEmphasis: restricted.observe((handler) => {
              objectAccess.assertBook(latestCurrent.bookId ?? "", "reading.events.observeEmphasis");
              return () => ({
                dispose: reading.events.observeEmphasis((snapshot) => {
                  try {
                    for (const item of snapshot)
                      objectAccess.assertReturnedBook(item.bookId, "reading.events.observeEmphasis");
                  } catch (error) {
                    log.debug("reading emphasis outside book grant", error);
                    return;
                  }
                  return handler(snapshot);
                }),
              });
            }),
            observeTime: restricted.observe((query, handler) => {
              if (!query?.bookId) throw pluginObjectAccessDenied("reading.events.observeTime");
              const bookId = query.bookId;
              objectAccess.assertBook(bookId, "reading.events.observeTime");
              return () => ({
                dispose: reading.events.observeTime(query, (event) => {
                  try {
                    objectAccess.assertBook(bookId, "reading.events.observeTime");
                    if (event.status === "ready") {
                      objectAccess.assertReturnedBook(event.snapshot.bookId, "reading.events.observeTime");
                      if (event.snapshot.nextCursor)
                        objectAccess.assertReturnedBook(event.snapshot.nextCursor.bookId, "reading.events.observeTime");
                    }
                  } catch (error) {
                    log.debug("reading time outside book grant", error);
                    return;
                  }
                  return handler(event);
                }),
              });
            }),
          },
          commands: reading.commands ? commandPolicy(reading.commands) : restricted.absent,
        });
      }
    }

    if (domain.annotations) {
      const annotations = domain.annotations;
      ctx.domains.annotations = {
        queries: annotations.queries,
        events: {
          subscribe: trackedOn(annotations.events.subscribe),
          observe: (query, handler) => track(() => ({ dispose: annotations.events.observe(query, handler) })),
        },
      };
      if (annotations.commands) {
        ctx.domains.annotations.commands = guardMutationTree(
          {
            createHighlight: async (
              input: Parameters<NonNullable<typeof annotations.commands>["createHighlight"]>[0],
            ) => {
              if (input.range !== undefined && !domain.library)
                throw new AppError("annotations/forbidden", "Range validation requires library read access");
              return annotations.commands!.createHighlight(input, lifecycle.signal);
            },
            applyChanges: (changes: import("@read-aware/core").AnnotationMutation[]) =>
              annotations.commands!.applyChanges(changes, lifecycle.signal),
            createNote: async (input: Parameters<NonNullable<typeof annotations.commands>["createNote"]>[0]) => {
              if (input.range !== undefined && !domain.library)
                throw new AppError("annotations/forbidden", "Range validation requires library read access");
              return annotations.commands!.createNote(input, lifecycle.signal);
            },
          },
          (operation) => lifecycle.assertActive(operation),
          "domains.annotations.commands",
        );
      }
      if (objectAccess.restricted) {
        const rawQueries = annotations.queries;
        const verifyAnnotation =
          (operation: string) =>
          (value: import("@read-aware/core").AnnotationSnapshot | import("@read-aware/core").AnnotationItem | null) => {
            if (value)
              objectAccess.assertReturnedBook(
                "annotation" in value ? value.annotation.bookId : value.bookId,
                operation,
              );
          };
        const verifyPage = (operation: string) => (page: import("@read-aware/core").AnnotationPage) => {
          for (const item of page.items) objectAccess.assertReturnedBook(item.bookId, operation);
        };
        const commandPolicy = (
          rawCommands: NonNullable<typeof annotations.commands>,
        ): RestrictedPolicy<NonNullable<PluginAnnotationsDomain["commands"]>> => ({
          applyChanges: restricted.command(async (changes) => {
            if (!Array.isArray(changes) || changes.length === 0)
              throw pluginObjectAccessDenied("annotations.commands.applyChanges");
            const snapshots = await Promise.all(
              changes.map((change) => annotations.queries.inspect(change.annotationId)),
            );
            const bookIds = new Set<string>();
            for (const snapshot of snapshots) {
              if (!snapshot) throw pluginObjectAccessDenied("annotations.commands.applyChanges");
              objectAccess.assertReturnedBook(snapshot.annotation.bookId, "annotations.commands.applyChanges");
              bookIds.add(snapshot.annotation.bookId);
            }
            if (bookIds.size !== 1) throw pluginObjectAccessDenied("annotations.commands.applyChanges");
            const bookId = [...bookIds][0];
            const fence = await objectAccess.beginBook(bookId, "annotations.commands.applyChanges");
            try {
              const result = await rawCommands.applyChanges(
                changes,
                combinePluginSignals(lifecycle.signal, fence.signal),
              );
              await fence.assertUnchanged();
              return result;
            } catch (error) {
              fence.dispose();
              throw error;
            }
          }),
          createHighlight: restricted.command(async (input) => {
            // Same permission rule as the unrestricted command: range validation reads the book source.
            if (input.range !== undefined && !domain.library)
              throw new AppError("annotations/forbidden", "Range validation requires library read access");
            if (input.range && input.range.bookId !== input.bookId)
              throw pluginObjectAccessDenied("annotations.commands.createHighlight");
            return scopedCommand(
              input.bookId,
              "annotations.commands.createHighlight",
              (signal) => rawCommands.createHighlight(input, signal),
              undefined,
              true,
              (value) => objectAccess.assertReturnedBook(value.bookId, "annotations.commands.createHighlight"),
            );
          }),
          createNote: restricted.command(async (input) => {
            if (input.range !== undefined && !domain.library)
              throw new AppError("annotations/forbidden", "Range validation requires library read access");
            if (input.range && input.range.bookId !== input.bookId)
              throw pluginObjectAccessDenied("annotations.commands.createNote");
            return scopedCommand(
              input.bookId,
              "annotations.commands.createNote",
              (signal) => rawCommands.createNote(input, signal),
              undefined,
              true,
              (value) => objectAccess.assertReturnedBook(value.bookId, "annotations.commands.createNote"),
            );
          }),
        });
        ctx.domains.annotations = restrictSurface<PluginAnnotationsDomain>(lifecycle, "domains.annotations", {
          queries: {
            inspect: restricted.read(async (annotationId) => {
              lifecycle.assertActive("annotations.queries.inspect");
              const snapshot = await lifecycle.read("annotations.queries.inspect", () =>
                rawQueries.inspect(annotationId),
              );
              verifyAnnotation("annotations.queries.inspect")(snapshot);
              return snapshot;
            }),
            page: restricted.read(async (input) => {
              const bookId = input?.bookId;
              if (!bookId) throw pluginObjectAccessDenied("annotations.queries.page");
              return scopedRead(
                bookId,
                "annotations.queries.page",
                () => rawQueries.page(input),
                undefined,
                verifyPage("annotations.queries.page"),
              );
            }),
            get: restricted.read(async (annotationId) => {
              lifecycle.assertActive("annotations.queries.get");
              const item = await lifecycle.read("annotations.queries.get", () => rawQueries.get(annotationId));
              verifyAnnotation("annotations.queries.get")(item);
              return item;
            }),
            list: restricted.read(async (filter) => {
              const bookId = filter?.bookId;
              if (!bookId) throw pluginObjectAccessDenied("annotations.queries.list");
              return scopedRead(
                bookId,
                "annotations.queries.list",
                () => rawQueries.list(filter),
                undefined,
                (items) => {
                  for (const item of items) objectAccess.assertReturnedBook(item.bookId, "annotations.queries.list");
                },
              );
            }),
          },
          events: {
            subscribe: restricted.deny,
            observe: restricted.observe((query, handler) => {
              if (query.kind !== "page" || !query.query?.bookId)
                throw pluginObjectAccessDenied("annotations.events.observe");
              const bookId = query.query.bookId;
              objectAccess.assertBook(bookId, "annotations.events.observe");
              return () => ({
                dispose: annotations.events.observe(query, (event) => {
                  try {
                    objectAccess.assertBook(bookId, "annotations.events.observe");
                    if (event.status === "ready" && event.result.kind === "page")
                      verifyPage("annotations.events.observe")(event.result.page);
                  } catch (error) {
                    log.debug("annotation observation outside book grant", error);
                    return;
                  }
                  return handler(event);
                }),
              });
            }),
          },
          commands: annotations.commands ? commandPolicy(annotations.commands) : restricted.absent,
        });
      }
    }

    if (domain.conversations) {
      ctx.domains.conversations = {
        queries: {
          ...domain.conversations.queries,
          getInsights: (target) =>
            lifecycle.read("conversations.getInsights", () => domain.conversations!.queries.getInsights(target)),
        },
        events: {
          observeRuntime: (handler) => track(() => ({ dispose: domain.conversations!.events.observeRuntime(handler) })),
          observeInvalidation: (handler) =>
            track(() => ({ dispose: domain.conversations!.events.observeInvalidation(handler) })),
          subscribe: trackedOn(domain.conversations.events.subscribe),
        },
        ...(domain.conversations.commands
          ? {
              commands: {
                requestTurn: (request: import("@read-aware/core").ConversationTurnRequest) => {
                  lifecycle.assertActive("conversations.requestTurn");
                  return domain.conversations!.commands!.requestTurn(request, lifecycle.signal);
                },
                cancelTurnRequest: (id: string) => {
                  lifecycle.assertActive("conversations.cancelTurnRequest");
                  return domain.conversations!.commands!.cancelTurnRequest(id, lifecycle.signal);
                },
                createThread: () => {
                  lifecycle.assertActive("conversations.createThread");
                  return domain.conversations!.commands!.createThread(lifecycle.signal);
                },
                selectThread: (id: string) => {
                  lifecycle.assertActive("conversations.selectThread");
                  return domain.conversations!.commands!.selectThread(id, lifecycle.signal);
                },
                stop: (target: import("@read-aware/core").ConversationTarget) => {
                  lifecycle.assertActive("conversations.stop");
                  return domain.conversations!.commands!.stop(target, lifecycle.signal);
                },
                clear: (target: import("@read-aware/core").ConversationTarget) => {
                  lifecycle.assertActive("conversations.clear");
                  return domain.conversations!.commands!.clear(target, lifecycle.signal);
                },
              },
            }
          : {}),
      };
    }

    if (objectAccess.restricted && domain.conversations) {
      ctx.domains.conversations = scopePluginConversations(
        domain.conversations,
        objectAccess,
        lifecycle,
        {
          current: () => latestCurrent,
          observe: (handler) => {
            let initial = true;
            return readingRuntime.observe((snapshot) => {
              const source = initial ? stampEventCause({}, operationActor) : snapshot;
              initial = false;
              return handler(source);
            });
          },
        },
        operationActor,
        scopedConversationState,
      );
    }

    if (domain.memory) {
      const memory = domain.memory;
      ctx.domains.memory = {
        queries: {
          ...memory.queries,
          entities: (input, options) => {
            const query = normalizeEntityQuery(input);
            return lifecycle.read(
              "memory.entities",
              (signal) => memory.queries.entities(query, signal),
              callSignal(options),
            );
          },
          profileContext: (input, options) => {
            const query = normalizeProfileInspectionQuery(input);
            return lifecycle.read(
              "memory.profileContext",
              (signal) => memory.queries.profileContext(query, signal),
              callSignal(options),
            );
          },
          context: {
            history: (query, options) =>
              lifecycle.read(
                "memory.context.history",
                (signal) => memory.queries.context.history(query, signal),
                callSignal(options),
              ),
            read: (query, options) =>
              lifecycle.read(
                "memory.context.read",
                (signal) => memory.queries.context.read(query, signal),
                callSignal(options),
              ),
            // The sealed handle joins this activation's resource queue; retirement releases it with the rest.
            export: (query, options) =>
              lifecycle.read(
                "memory.context.export",
                (signal) => memory.queries.context.export(query, resources, signal),
                callSignal(options),
              ),
          },
        },
        events: { observe: (query, handler) => track(() => ({ dispose: memory.events.observe(query, handler) })) },
        ...(memory.commands
          ? {
              commands: {
                mutate: (input) => {
                  lifecycle.assertActive("domains.memory.commands.mutate");
                  return memory.commands!.mutate(input);
                },
                context: {
                  capture: (selector, options) => {
                    lifecycle.assertActive("domains.memory.commands.context.capture");
                    return memory.commands!.context.capture(selector, callSignal(options));
                  },
                },
                updateProfile: (input) => {
                  lifecycle.assertActive("domains.memory.commands.updateProfile");
                  return memory.commands!.updateProfile(input);
                },
                completeOnboarding: (input, options) => {
                  lifecycle.assertActive("domains.memory.commands.completeOnboarding");
                  return memory.commands!.completeOnboarding(input, callSignal(options));
                },
                decideEntity: (input, options) => {
                  lifecycle.assertActive("domains.memory.commands.decideEntity");
                  return memory.commands!.decideEntity(input, callSignal(options));
                },
                classify: (input) => {
                  lifecycle.assertActive("domains.memory.commands.classify");
                  return memory.commands!.classify(input);
                },
                startGraphTask: (bookId, mode, options) => {
                  lifecycle.assertActive("domains.memory.commands.startGraphTask");
                  if (!canUseHostService("llm", permissions))
                    throw new AppError("memory/forbidden", "Graph generation requires service:llm");
                  return memory.commands!.startGraphTask(bookId, mode, options);
                },
                retryGraphTask: (bookId, taskId, options) => {
                  lifecycle.assertActive("domains.memory.commands.retryGraphTask");
                  if (!canUseHostService("llm", permissions))
                    throw new AppError("memory/forbidden", "Graph generation requires service:llm");
                  return memory.commands!.retryGraphTask(bookId, taskId, options);
                },
                cancelGraphTask: (bookId, taskId) => {
                  lifecycle.assertActive("domains.memory.commands.cancelGraphTask");
                  return memory.commands!.cancelGraphTask(bookId, taskId);
                },
              },
            }
          : {}),
      };
    }

    if (objectAccess.restricted && domain.memory) {
      ctx.domains.memory = scopePluginMemory(
        domain.memory,
        objectAccess,
        lifecycle,
        resources,
        canUseHostService("llm", permissions),
      );
    }

    // ─── Services ─────────────────────────────────────────────────────────────

    if (canUseHostService("sync", permissions)) {
      ctx.services.sync = {
        snapshot: async () => {
          lifecycle.assertActive("services.sync.snapshot");
          return hostSync.snapshot();
        },
        backlog: () => {
          lifecycle.assertActive("services.sync.backlog");
          return hostSync.backlog(lifecycle.signal);
        },
        account: () => {
          lifecycle.assertActive("services.sync.account");
          return hostSync.account(lifecycle.signal);
        },
        requestSync: () => {
          lifecycle.assertActive("services.sync.requestSync");
          return hostSync.requestSync(lifecycle.signal, operationActor);
        },
        openSettings: () => {
          lifecycle.assertActive("services.sync.openSettings");
          return hostSync.openSettings(lifecycle.signal, operationActor);
        },
        connectionOptions: async () => {
          lifecycle.assertActive("services.sync.connectionOptions");
          return hostSync.connectionOptions();
        },
        requestFlow: (request, options) => {
          lifecycle.assertActive("services.sync.requestFlow");
          const signal = pluginOperationSignal(lifecycle.signal, options);
          return lifecycle.read(
            "services.sync.requestFlow",
            () => hostSync.requestFlow(request, signal, operationActor),
            signal,
          );
        },
        observe: (handler) => track(() => ({ dispose: hostSync.observe(handler, operationActor) })),
      };
    }

    if (canUseHostService("network", permissions)) {
      ctx.services.network = network ??= createPluginNetworkService(
        manifest.networkAccess,
        lifecycle,
        corsFreeFetch,
        selfOrigin,
      );
    }

    if (canUseHostService("llm", permissions)) {
      ctx.services.llm = llm ??= createPluginLlm(
        manifest.id,
        lifecycle,
        getAgentRuntime,
        undefined,
        (id, signal) => resourceModelImage(resources, id, signal),
        inferenceHistoryStorage(manifest.id),
        { check: checkOperationAvailability },
      );
    }

    if (canUseHostService("clipboard", permissions)) {
      ctx.services.clipboard = {
        writeImage: (id) => {
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
      ctx.services.ui.openExternal = (url) => {
        lifecycle.assertActive("services.ui.openExternal");
        return hostIO.openExternal(url, lifecycle.signal);
      };
    }

    if (serviceInvocation && objectAccess.grant.mode === "book") {
      ctx.services.storage = bookServiceStorage(ctx.services.storage, objectAccess.grant.bookId);
      ctx.services.secrets = {
        get: denyUnscopedServiceData,
        set: denyUnscopedServiceData,
        remove: denyUnscopedServiceData,
      };
      ctx.services.resources.assets = {
        policy: denyUnscopedServiceData,
        list: denyUnscopedServiceData,
        get: denyUnscopedServiceData,
        store: denyUnscopedServiceData,
        open: denyUnscopedServiceData,
        delete: denyUnscopedServiceData,
      };
    }
    attachPluginEventReactions(ctx, reactions);
    if (typeof operationActor === "object") contexts.set(operationActor, ctx);
    return ctx;
  };
  return {
    context: contextForActor(serviceInvocation?.origin ?? selfOrigin),
    lifecycle,
    reactions,
    contextForActor,
    registrationForActor: (registration, actor) => contributionHandles.withSource(registration, actor),
    serviceParticipant: serviceParticipant(serviceInvocation?.origin ?? selfOrigin),
  };
}
