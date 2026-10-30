import { createPluginJobs } from "../plugin-jobs";
import { createPluginChanges } from "../plugin-changes";
import { createPluginTransactions } from "../plugin-transactions";
import type { PluginServiceParticipant } from "../plugin-services";
import type { DomainActorOwners } from "../../../../domain/actor-owners";
import { PluginEventReactions } from "../plugin-event-reactions";
import type { DomainActor } from "../../../../platform/domain-actor";
import type { PluginActionRegistration, PluginCallOptions } from "@read-aware/plugin-types";
import { pluginOperationSignal } from "../plugin-call-options";
import { readerReferencePreview } from "../../../../services/reader-reference-preview";
import {
  AppError,
  domainGrantsFromPermissions,
  type DomainEventType,
  type SettingsAccessPolicy,
} from "@read-aware/core";
import { PluginContributionReactions } from "../plugin-contribution-reactions";
import type { HostActionRegistration } from "../../state/interactive-contribution-registry";
import { createResourceOwner } from "../../../../services/resources";
import { registerPluginImageOwner } from "../../lib/plugin-image-owner";
import { registerPluginFileDropOwner } from "../../lib/plugin-file-drop";
import { createBookImportTasks } from "../../../../domain/library-import-tasks";
import { createActorDomainView, createSettingsDomain, type DomainEventSubscribe } from "../../../../domain";
import type { PluginBookAccess, PluginContext, PluginDisposable, PluginManifest } from "../../lib/plugin-types";
import { createPluginDocuments } from "../plugin-documents";
import { PluginDocumentObserver } from "../plugin-document-observer";
import { createPluginLogging } from "../plugin-logging";
import { PluginLifecycleController } from "../plugin-lifecycle";
import {
  createPluginBookAccessPolicy,
  pluginObjectAccessDenied,
  type CurrentBookSnapshot,
  type PluginBookAccessFenceOptions,
  type PluginBookAccessPolicy,
} from "../../../../domain/plugin-object-access";
import { readingRuntime } from "../../../../domain/reading-runtime";
import { settled } from "../../../../platform/write-settlement";
import { combinePluginSignals, pluginStoragePrefix } from "./helpers";
import { createLogger } from "../../../../platform/logger";

const log = createLogger("plugins");

/** Everything one plugin activation shares across the contexts built for its actors:
 * the immutable book grant, lifecycle, authorization fences and owned resources. */
export function createPluginActivationKit(
  manifest: PluginManifest,
  appVersion: string,
  disposables: PluginDisposable[],
  bookAccess: PluginBookAccess = { mode: "all" },
  serviceInvocation?: { origin: DomainActor; lineage: readonly string[] },
) {
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
  const logging = createPluginLogging(manifest.id, manifest.version, lifecycle);
  const scopedWorkspaceState = { revision: 0 };
  const scopedConversationState = { revision: 0 };
  // Built once per activation and shared by every actor's context.
  const lazy: {
    network?: PluginContext["services"]["network"];
    llm?: PluginContext["services"]["llm"];
    jobs?: ReturnType<typeof createPluginJobs>;
  } = {};
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
  return {
    manifest,
    appVersion,
    serviceInvocation,
    grantedBookAccess,
    grantedMetadata,
    permissions,
    selfOrigin,
    lifecycle,
    callSignal,
    /** The reading session last seen by this activation's book-access policy. */
    currentBook: () => latestCurrent,
    objectAccess,
    assertBookScope,
    authorizeBook,
    scopedRead,
    scopedCurrentRead,
    scopedCommand,
    scopedCurrentCommand,
    referencePreviewOwner,
    resources,
    importTasks,
    activationLifecycle,
    owners,
    documentObserver,
    transactionBudget,
    logging,
    scopedWorkspaceState,
    scopedConversationState,
    reactions,
    contributionHandles,
    serviceParticipant,
    lazy,
  };
}

export type PluginActivationKit = ReturnType<typeof createPluginActivationKit>;

/** What one actor's context is built from: the activation plus the domain view,
 * settings, transactions and tracking bound to that actor. */
export function createPluginActorKit(activation: PluginActivationKit, operationActor: DomainActor) {
  const {
    manifest,
    serviceInvocation,
    permissions,
    selfOrigin,
    lifecycle,
    objectAccess,
    owners,
    documentObserver,
    transactionBudget,
    contributionHandles,
    lazy,
  } = activation;
  // Installed by the workspace facet once the library domain is granted.
  const availability: {
    command?: (
      request: import("@read-aware/core").HostCommandRequest,
      signal: AbortSignal,
    ) => Promise<import("@read-aware/core").OperationAvailability>;
  } = {};
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
    lazy.jobs ??= createPluginJobs(manifest, objectAccess, lifecycle, transactions(), operationActor);
  const jobs = () => {
    if (serviceInvocation || !lazy.jobs)
      throw new AppError("plugin/permission-denied", "Persistent jobs require an activation owner");
    return lazy.jobs;
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
  return {
    ...activation,
    operationActor,
    documents,
    domain,
    settingsAccess,
    transactions,
    jobs,
    transactionCall,
    settingsDomain,
    changes,
    storagePrefix,
    track,
    trackContribution,
    trackAction,
    brand,
    trackedOn,
    deliverSettingsEvent,
    availability,
  };
}

export type PluginActorKit = ReturnType<typeof createPluginActorKit>;
