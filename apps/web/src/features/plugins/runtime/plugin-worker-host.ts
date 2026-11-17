import { pluginServices, type PluginServiceExecution } from "./plugin-services";
/**
 * Host side of the plugin sandbox.
 *
 * Owns one Worker per plugin and is the only thing standing between it and the
 * app. The plugin's code runs where `__TAURI_INTERNALS__` does not exist (see
 * plugin-sandbox.worker.ts), so everything it wants has to arrive here as a
 * message — and everything here goes through `buildPluginContext`, which is the
 * same permission-gated surface plugins used to hold directly. The difference
 * is that it is now the ONLY surface: a plugin can no longer step around the
 * object it was handed.
 *
 * Contributions register in reverse: the Worker sends a serializable
 * description with handles standing in for its functions, and this module
 * re-registers it with those handles wrapped as async calls back into the
 * Worker.
 */
import type {
  PluginContext,
  PluginDisposable,
  PluginMigration,
  PluginManifest,
  PluginBookAccess,
  PluginStorage,
} from "@read-aware/plugin-types";
import { AppError, errorCode } from "@read-aware/core";
import { injectPluginCallSignal, pluginCallDrainsCancellation } from "./plugin-call-options";
import { buildPluginContext, currentAppLocale, pluginStoragePrefix } from "./plugin-context";
import { pluginModuleUrl } from "./plugin-backend";
import { i18n, localeActor } from "../../../i18n";
import { onAppEvent } from "../../../platform/app-events";
import { actorFromEvent, causalActor, stampEventCause, type DomainActor } from "../../../platform/domain-actor";
import { localKV, onLocalKVChange } from "../../../platform/local-store";
import { createLogger } from "../../../platform/logger";
import { invalidateSyncTransportSessions } from "../../../platform/sync/transport-registry";
import { updateInstalledPlugin } from "../state/plugin-store";
import { flattenPluginRequest, flattenPluginResponse } from "./plugin-network-wire";
import { PluginRpcPending } from "./plugin-rpc-pending";
import { pluginCallbackInvoker } from "./plugin-callback-results";
import { decodePluginCallbacks, retainPluginCallbacks, type PluginCallbackWire } from "./plugin-callback-wire";
import type { PluginActionRegistration } from "../lib/plugin-types";
import {
  parsePluginWorkerMessage,
  PLUGIN_PROTOCOL_VERSION,
  rejectedPluginCallbackHandles,
  validPluginCallId,
  type WorkerMessage,
} from "./plugin-worker-protocol";
import { parsePluginHostMessage, type ContextShape, type HostMessage } from "./plugin-host-protocol";
export type { ContextShape } from "./plugin-host-protocol";
import { PLUGIN_WIRE_LIMITS } from "./plugin-wire-budget";
import { PluginCallbackBudget } from "./plugin-callback-budget";
import { pluginHostBudget, pluginTrafficBudget, type BudgetLease } from "./plugin-host-budget";

import type { PluginLifecycleController } from "./plugin-lifecycle";

export type PluginRestoreStorage = {
  create(lifecycle: PluginLifecycleController): PluginStorage;
  snapshot(): Record<string, string>;
};

type HeldRegistration = PluginDisposable &
  Partial<Pick<PluginActionRegistration, "updateState">> & { contribution?: PluginDisposable };
const actionRegistrations = new Set(
  ["uriHandlers", "selectionActions", "headerActions", "contextActions", "commands", "agentTools"].map(
    (point) => `contributions.${point}.register`,
  ),
);

const log = createLogger("plugins");
/** How long a plugin's own deactivate() may run before its Worker is terminated anyway. */
const DEACTIVATION_DEADLINE_MS = 2_000;

export type SandboxedPlugin = {
  manifest: PluginManifest;
  readonly hasMigration: boolean;
  checkHealth(): Promise<void>;
  migrate(migration: PluginMigration): Promise<void>;
  /** Host-owned manifest contributions share the realm lifecycle and provenance. */
  stageHostContribution(factory: (source: DomainActor) => { dispose(source?: DomainActor): void }): void;
  promote(): void;
  terminate(source?: DomainActor): Promise<void>;
  invokeService?(serviceId: string, input: unknown): Promise<unknown>;
};

export type StartPluginWorkerOptions = {
  /** Host-only source for calls admitted before the activation-ready message. */
  activationOrigin?: DomainActor;
  /** Host-only execution authority. Never accepted in a Worker call payload. */
  serviceExecution?: Pick<PluginServiceExecution, "declaration" | "lineage" | "origin" | "signal">;
  /** Host-owned object grant for this activation; never read from Worker input. */
  bookAccess?: PluginBookAccess;
  /** Alternate entry URL for a separately staged update candidate. */
  moduleUrl?: string;
  /** Private restore namespace; never receives live storage broadcasts. */
  restoreStorage?: PluginRestoreStorage;
  /** Distinguishes two simultaneous versions of one plugin. */
  instanceId?: string;
  /** Candidate failures must not overwrite the installed version's status. */
  onRuntimeError?: (message: string, source: DomainActor) => void;
};

// ─── Host → worker state sync ────────────────────────────────────────────────
//
// The worker keeps local mirrors so `storage.get()` and `ctx.locale` stay
// synchronous. Worker-side writes already flow back here; this is the other
// direction: when the HOST changes (a settings edit from the Plugins panel,
// the app language switching), every live sandbox gets a `sync` patch, or
// its mirror silently serves boot-time values forever.

const liveWorkers = new Map<
  string,
  {
    pluginId: string;
    worker: Worker;
    sync: (patch: Extract<HostMessage, { t: "sync" }>["patch"], source: DomainActor) => void;
  }
>();
let syncWired = false;

function wireHostSync(): void {
  if (syncWired) return;
  syncWired = true;
  onLocalKVChange((key, _value, origin) => {
    const changed = new Set<string>();
    for (const { pluginId, sync } of liveWorkers.values()) {
      const prefix = pluginStoragePrefix(pluginId);
      if (key.startsWith(prefix)) sync({ storage: localKV.entries(prefix) }, origin);
      if (key === `${prefix}settings`) changed.add(pluginId);
    }
    for (const pluginId of changed) invalidateSyncTransportSessions(pluginId, origin);
  });
  onAppEvent("plugin-storage-changed", (event) => {
    const { pluginId } = event;
    const source = actorFromEvent(event);
    for (const live of liveWorkers.values()) {
      if (live.pluginId !== pluginId) continue;
      live.sync({ storage: localKV.entries(pluginStoragePrefix(pluginId)) }, source);
    }
    invalidateSyncTransportSessions(pluginId, source);
  });
  i18n.on("languageChanged", () => {
    const locale = currentAppLocale(),
      source = localeActor();
    for (const { sync } of liveWorkers.values()) {
      sync({ locale }, source);
    }
  });
}

/**
 * Walk a dotted method path to the callable on the real context.
 *
 * A namespace the manifest did not earn simply isn't on the context, so an
 * unauthorized call lands here as a missing property and is refused — the same
 * outcome as before, now enforced across a realm boundary the plugin cannot
 * reach past. `storage.collection(name).op` carries its collection inline.
 */
function resolveMethod(ctx: PluginContext, method: string): ((...args: unknown[]) => unknown) | null {
  // Own enumerable properties of plain objects only — the context is built
  // entirely from literals, so anything reachable via the prototype chain
  // (`constructor` and friends) is by definition not part of the granted
  // surface and must not resolve.
  const step = (target: unknown, key: string): unknown =>
    target !== null && typeof target === "object" && Object.prototype.hasOwnProperty.call(target, key)
      ? (target as Record<string, unknown>)[key]
      : undefined;
  const collection = method.match(/^services\.storage\.collection\(([^)]*)\)\.(\w+)$/);
  if (collection) {
    const api = ctx.services.storage.collection(collection[1]) as unknown as Record<string, unknown>;
    const fn = step(api, collection[2]);
    return typeof fn === "function" ? (fn as (...a: unknown[]) => unknown).bind(api) : null;
  }
  const parts = method.split(".");
  let target: unknown = ctx;
  for (let i = 0; i < parts.length - 1; i += 1) {
    target = step(target, parts[i]);
    if (!target) return null;
  }
  const fn = step(target, parts[parts.length - 1]);
  return typeof fn === "function" ? (fn as (...a: unknown[]) => unknown).bind(target) : null;
}

/**
 * The context's SHAPE, as a tree of "fn" leaves and nested namespaces.
 *
 * The Worker builds its proxy from this rather than from a hand-written copy of
 * the API. Hand-copying is how a sandbox silently drifts from the real surface
 * — miss that `books.write` is a nested namespace and a plugin gets a context
 * that fails its own capability check. Deriving it means the sandbox exposes
 * exactly what `buildPluginContext` decided to grant, no more and no less.
 */
/** Data (not callables) the Worker mirrors locally to keep sync reads sync. */
const SHAPE_SKIP = new Set(["manifest", "appVersion", "locale", "lifecycle", "capabilities", "grants"]);

function describeShape(value: unknown, depth = 0): ContextShape {
  const shape: ContextShape = {};
  if (!value || typeof value !== "object" || depth > 8) return shape;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "function") shape[key] = "fn";
    else if (entry && typeof entry === "object") shape[key] = describeShape(entry, depth + 1);
  }
  return shape;
}

export function describeContext(ctx: PluginContext): ContextShape {
  const shape: ContextShape = {};
  for (const [key, value] of Object.entries(ctx as unknown as Record<string, unknown>)) {
    if (SHAPE_SKIP.has(key)) continue;
    if (typeof value === "function") shape[key] = "fn";
    else if (value && typeof value === "object") shape[key] = describeShape(value, 1);
  }
  // `storage.collection()` is a factory, so its methods are described from a
  // throwaway instance rather than discovered on the context itself.
  try {
    shape.__collection = describeShape(ctx.services.storage.collection("probe"), 1);
  } catch {
    shape.__collection = {};
  }
  return shape;
}

export function startPluginWorker(
  manifest: PluginManifest,
  appVersion: string,
  disposables: PluginDisposable[],
  options: StartPluginWorkerOptions = {},
): Promise<SandboxedPlugin> {
  options.serviceExecution?.signal.throwIfAborted();
  const runtime = buildPluginContext(manifest, appVersion, disposables, options.bookAccess, options.serviceExecution);
  if (options.serviceExecution) runtime.context.contributions = {} as PluginContext["contributions"];
  const ctx = options.restoreStorage
    ? {
        ...runtime.context,
        services: { ...runtime.context.services, storage: options.restoreStorage.create(runtime.lifecycle) },
      }
    : runtime.context;
  // Select per admitted call, never alter the retained Worker context. Later
  // user callbacks must not inherit the startup source. Isolated service and
  // restore contexts already have their own authority and storage bindings.
  const activationActor =
    options.serviceExecution || options.restoreStorage
      ? undefined
      : actorFromEvent(stampEventCause({}, causalActor(options.activationOrigin ?? "system")), `plugin:${manifest.id}`);
  const activationContext = activationActor ? runtime.contextForActor(activationActor) : ctx;
  if (!options.serviceExecution && !options.restoreStorage && manifest.services?.length) {
    runtime.lifecycle.stage(() =>
      pluginServices.register(runtime.serviceParticipant, async (execution) => {
        const child = await startPluginWorker(execution.manifest, appVersion, [], {
          bookAccess: execution.bookAccess,
          moduleUrl: options.moduleUrl ?? pluginModuleUrl(manifest.id, manifest.main ?? "main.js"),
          instanceId: `service:${execution.callId}`,
          serviceExecution: execution,
          onRuntimeError: () => {},
        });
        try {
          execution.signal.throwIfAborted();
          child.promote();
          if (!child.invokeService)
            throw new AppError("plugin/service-unavailable", "Missing service execution transport");
          return await child.invokeService(execution.declaration.id, execution.input);
        } finally {
          const closing = child.terminate();
          runtime.lifecycle.trackCleanup(closing);
          await closing;
        }
      }),
    );
  }
  const bookService = Boolean(options.serviceExecution && ctx.grants.book.mode !== "all");
  const storageSnapshot = () =>
    bookService ? {} : (options.restoreStorage?.snapshot() ?? localKV.entries(pluginStoragePrefix(manifest.id)));
  const worker = new Worker(new URL("./plugin-sandbox.worker.ts", import.meta.url), {
    type: "module",
    name: `plugin:${manifest.id}`,
  });
  const instanceId = options.instanceId ?? manifest.id;
  wireHostSync();
  let releaseServiceAbort: (() => void) | undefined;
  let terminated = false;
  let quiescing = false;
  let termination: Promise<void> | undefined;
  let invalidMessageReported = false;
  let acknowledgeQuiescence: ((error?: string) => void) | undefined;
  let acknowledgeDeactivation: (() => void) | undefined;
  const traffic = pluginTrafficBudget.open();
  let retireForTraffic: (error: unknown) => void;
  const accountTraffic = (usage?: { bytes: number; entries: number }) => {
    try {
      if (usage) traffic.graph(usage);
      else traffic.message();
    } catch (error) {
      retireForTraffic(error);
      throw error;
    }
  };
  const post = (input: HostMessage) => {
    if (terminated) return;
    accountTraffic();
    const message = "error" in input ? { ...input, error: input.error.slice(0, 4096) } : input;
    worker.postMessage(parsePluginHostMessage(message, accountTraffic));
  };

  const pendingInvokes = new PluginRpcPending();
  const callbackBudget = new PluginCallbackBudget((count) => pluginHostBudget.reserve("callbacks", count));
  const incomingCalls = new Map<number, { controller: AbortController; settled: Promise<void> }>();
  let callAdmissionClosed = false;
  const abortIncomingCalls = () => {
    for (const { controller } of incomingCalls.values())
      controller.abort(new AppError("plugin/cancelled", "Plugin runtime stopped"));
  };
  let nextHealthId = 1;
  const pendingHealth = new Map<
    number,
    { resolve: () => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }
  >();
  let nextMigrationId = 1;
  const pendingMigrations = new Map<
    number,
    { source: DomainActor; resolve: () => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }
  >();
  const failAllHealthChecks = (reason: string) => {
    for (const pending of pendingHealth.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new AppError("plugin/unavailable", reason));
    }
    pendingHealth.clear();
  };
  const failAllMigrations = (reason: string) => {
    for (const pending of pendingMigrations.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new AppError("plugin/unavailable", reason));
    }
    pendingMigrations.clear();
  };
  /** Call a function the plugin kept inside the Worker. */
  const invokeHandle = async (handle: string, args: unknown[]): Promise<unknown> => {
    const lease = pluginHostBudget.reserve("invokes");
    try {
      return await pendingInvokes.call((id) => {
        post({ t: "invoke", id, handle, args });
      });
    } finally {
      lease.release();
    }
  };

  const releaseCallbacks = (wire: PluginCallbackWire) => {
    const handles = Array.isArray(wire?.callbacks)
      ? wire.callbacks.flatMap((entry) => (typeof entry?.handle === "string" ? [entry.handle] : []))
      : [];
    if (!terminated && handles.length) post({ t: "release", handles });
  };

  /**
   * Disposables the plugin is holding. A `PluginDisposable` cannot be cloned, so
   * the Worker gets a handle and releases it by sending that back.
   */
  const heldDisposables = new Map<string, HeldRegistration>();
  let nextDisposableId = 1;

  const assertRunning = () => {
    if (terminated || quiescing) throw new AppError("plugin/unavailable", "Plugin runtime stopped");
  };
  const closeTransport = (reason: string) => {
    if (terminated) return;
    terminated = true;
    releaseServiceAbort?.();
    quiescing = true;
    runtime.lifecycle.cancelOperations();
    abortIncomingCalls();
    pendingInvokes.close(new AppError("plugin/unavailable", reason));
    failAllHealthChecks(reason);
    failAllMigrations(reason);
    acknowledgeQuiescence?.(reason);
    const live = liveWorkers.get(instanceId);
    if (live?.worker === worker) liveWorkers.delete(instanceId);
    worker.terminate();
    callbackBudget.close();
  };
  const drainRuntime = async () => {
    // A Worker cancellation/quiescence receipt is not evidence that an already
    // dispatched native write has finished. Close admission, then await host work.
    callAdmissionClosed = true;
    const errors: unknown[] = [];
    try {
      runtime.lifecycle.stop();
    } catch (error) {
      errors.push(error);
    }
    for (const disposable of heldDisposables.values()) {
      try {
        disposable.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    heldDisposables.clear();
    while (incomingCalls.size) await Promise.all([...incomingCalls.values()].map((call) => call.settled));
    try {
      await runtime.lifecycle.drainCleanups();
    } catch (error) {
      errors.push(error);
    }
    try {
      await runtime.lifecycle.drainStorageWrites();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) throw new AggregateError(errors, "Plugin shutdown failed");
  };

  return new Promise<SandboxedPlugin>((resolve, reject) => {
    let startupSettled = false;
    const ordinarySource = () =>
      !startupSettled || runtime.lifecycle.phase === "migrating" ? activationActor : undefined;
    let handshaken = false;
    const failRuntime = (reason: string, failureSource?: DomainActor) => {
      const source = runtime.lifecycle.beginRetirement(
        failureSource ?? ordinarySource() ?? options.serviceExecution?.origin ?? "system",
      );
      const starting = !startupSettled;
      const currentInstance = liveWorkers.get(instanceId)?.worker === worker;
      startupSettled = true;
      clearTimeout(activationTimeout);
      closeTransport(reason);
      termination ??= drainRuntime();
      // A fatal transport failure has no caller to await shutdown. Keep the
      // same promise for terminate(), but always observe background failures.
      void termination.catch((error) => log.error(`Cleanup after failure in "${manifest.id}" failed`, error));
      if (starting)
        void termination.then(
          () => reject(new AppError("plugin/unavailable", reason)),
          (error) =>
            reject(
              new AggregateError(
                [new AppError("plugin/unavailable", reason), error],
                "Plugin activation and cleanup failed",
              ),
            ),
        );
      else {
        log.error(`runtime error in "${manifest.id}"`, reason);
        if (options.onRuntimeError) options.onRuntimeError(reason, source);
        else if (currentInstance)
          updateInstalledPlugin(manifest.id, { error: new AppError("plugin/unavailable", reason) }, source);
      }
    };
    const activationTimeout = setTimeout(() => {
      if (startupSettled) return;
      failRuntime("plugin activation timed out");
    }, 10_000);
    if (options.serviceExecution) {
      const signal = options.serviceExecution.signal;
      const abort = () => failRuntime("Plugin service invocation cancelled");
      signal.addEventListener("abort", abort, { once: true });
      releaseServiceAbort = () => signal.removeEventListener("abort", abort);
      if (signal.aborted) {
        abort();
        return;
      }
    }
    retireForTraffic = (error) =>
      failRuntime(error instanceof Error ? error.message : "Plugin transport traffic exhausted");
    if (!options.restoreStorage)
      liveWorkers.set(instanceId, {
        pluginId: manifest.id,
        worker,
        sync(patch, source) {
          try {
            post({ t: "sync", patch: bookService && patch.storage ? { ...patch, storage: {} } : patch });
          } catch (error) {
            failRuntime(error instanceof Error ? error.message : String(error), source);
          }
        },
      });

    worker.onerror = (event) => {
      if (!terminated) failRuntime(event.message || "plugin worker failed");
    };
    worker.onmessageerror = () => {
      if (!terminated) failRuntime("plugin message could not be deserialized");
    };

    worker.onmessage = async (event: MessageEvent<unknown>) => {
      if (terminated) return;
      let message: WorkerMessage;
      try {
        accountTraffic();
        message = parsePluginWorkerMessage(event.data, accountTraffic);
      } catch (error) {
        if (terminated) return;
        // Correlate only the envelope, never invoke methods or inspect arbitrary
        // callback graphs after failed admission. Rate-limit diagnostics per realm.
        if (!invalidMessageReported) {
          invalidMessageReported = true;
          log.warn(`Invalid Worker message from "${manifest.id}"`, error);
        }
        const handles = rejectedPluginCallbackHandles(event.data);
        if (handles.length) post({ t: "release", handles });
        const raw = event.data as { t?: unknown; id?: unknown } | null;
        if (!handshaken || raw?.t === "hello" || raw?.t === "ready") {
          failRuntime("Plugin transport handshake rejected");
          return;
        }
        if (raw && validPluginCallId(raw.id)) {
          if (raw.t === "call")
            post({ t: "result", id: raw.id, ok: false, code: errorCode(error), error: "Plugin message rejected" });
          else if (raw.t === "result") pendingInvokes.settle(raw.id, false, error);
        }
        return;
      }
      if (message.t === "hello") {
        if (handshaken) failRuntime("Duplicate plugin transport handshake");
        else handshaken = true;
        return;
      }
      if (!handshaken && message.t !== "failed") {
        failRuntime("Plugin called host before transport handshake");
        return;
      }
      switch (message.t) {
        case "ready":
          if (!startupSettled) {
            startupSettled = true;
            clearTimeout(activationTimeout);
            resolve({
              manifest,
              hasMigration: message.hasMigration,
              invokeService(serviceId, input) {
                assertRunning();
                if (!options.serviceExecution || options.serviceExecution.declaration.id !== serviceId)
                  return Promise.reject(new AppError("plugin/service-unavailable", "Service export is unavailable"));
                return pendingInvokes.call((id) => post({ t: "service", id, serviceId, input }));
              },
              checkHealth() {
                try {
                  assertRunning();
                } catch (error) {
                  return Promise.reject(error);
                }
                const id = nextHealthId++;
                return new Promise<void>((healthResolve, healthReject) => {
                  const timeout = setTimeout(() => {
                    pendingHealth.delete(id);
                    healthReject(new Error("plugin health check timed out"));
                  }, 2_000);
                  pendingHealth.set(id, {
                    resolve: healthResolve,
                    reject: healthReject,
                    timeout,
                  });
                  try {
                    post({ t: "health", id });
                  } catch (error) {
                    failRuntime(error instanceof Error ? error.message : String(error));
                  }
                });
              },
              migrate(migration) {
                try {
                  assertRunning();
                } catch (error) {
                  return Promise.reject(error);
                }
                const id = nextMigrationId++;
                const source = activationActor ?? options.serviceExecution?.origin ?? causalActor("system");
                try {
                  parsePluginHostMessage({ t: "migrate", id, migration });
                } catch (error) {
                  return Promise.reject(error);
                }
                runtime.lifecycle.beginMigration();
                try {
                  post({ t: "sync", patch: { phase: "migrating", storage: storageSnapshot() } });
                } catch (error) {
                  failRuntime(error instanceof Error ? error.message : String(error), source);
                  return Promise.reject(error);
                }
                return new Promise<void>((migrationResolve, migrationReject) => {
                  const timeout = setTimeout(() => {
                    pendingMigrations.delete(id);
                    runtime.lifecycle.finishMigration();
                    try {
                      post({ t: "sync", patch: { phase: "activating" } });
                    } catch (error) {
                      failRuntime(error instanceof Error ? error.message : String(error), source);
                    }
                    migrationReject(new Error("plugin data migration timed out"));
                  }, 30_000);
                  pendingMigrations.set(id, {
                    source,
                    resolve: migrationResolve,
                    reject: migrationReject,
                    timeout,
                  });
                  try {
                    post({ t: "migrate", id, migration });
                  } catch (error) {
                    failRuntime(error instanceof Error ? error.message : String(error), source);
                  }
                });
              },
              stageHostContribution(factory) {
                if (!activationActor)
                  throw new AppError("plugin/unavailable", "Isolated executions cannot install manifest contributions");
                runtime.lifecycle.stage(() => {
                  const registration = factory(activationActor);
                  return { dispose: () => registration.dispose(runtime.lifecycle.retirementActor ?? activationActor) };
                });
              },
              promote() {
                assertRunning();
                post({ t: "sync", patch: { phase: "active" } });
                try {
                  runtime.lifecycle.promote();
                } catch (error) {
                  post({ t: "sync", patch: { phase: "activating" } });
                  throw error;
                }
              },
              terminate(source: DomainActor = "system") {
                if (!termination) runtime.lifecycle.beginRetirement(source);
                return (termination ??= (async () => {
                  quiescing = true;
                  runtime.lifecycle.cancelOperations();
                  abortIncomingCalls();
                  // This message barrier lets already-issued Worker writes reach
                  // the host before it closes the gate and drains native writes.
                  const quiescenceError = await new Promise<string | undefined>((done) => {
                    const timeout = setTimeout(() => done("plugin quiescence timed out"), 2_000);
                    acknowledgeQuiescence = (error) => {
                      clearTimeout(timeout);
                      done(error);
                    };
                    try {
                      post({ t: "quiesce" });
                    } catch (error) {
                      acknowledgeQuiescence?.(error instanceof Error ? error.message : String(error));
                    }
                  });
                  acknowledgeQuiescence = undefined;
                  // Retire migration timers/results before closing the lifecycle:
                  // a late response must not reopen (or throw from) a stopped realm.
                  failAllMigrations(`plugin "${manifest.id}" was deactivated`);
                  try {
                    await drainRuntime();
                    if (quiescenceError) throw new AppError("plugin/unavailable", quiescenceError);
                  } finally {
                    // Wait for the plugin's own deactivate() to settle, bounded like quiescence.
                    let settle: (() => void) | undefined;
                    const deactivated = new Promise<void>((done) => {
                      const timeout = setTimeout(() => {
                        log.warn(`plugin "${manifest.id}" did not finish deactivating; terminating it`);
                        done();
                      }, DEACTIVATION_DEADLINE_MS);
                      settle = acknowledgeDeactivation = () => {
                        clearTimeout(timeout);
                        done();
                      };
                    });
                    try {
                      post({ t: "deactivate" });
                      await deactivated;
                    } finally {
                      settle?.();
                      acknowledgeDeactivation = undefined;
                      closeTransport(`plugin "${manifest.id}" was deactivated`);
                    }
                  }
                })());
              },
            });
          }
          return;

        case "failed":
          failRuntime(message.error);
          return;

        case "dispose": {
          const disposable = heldDisposables.get(message.handle);
          heldDisposables.delete(message.handle);
          try {
            const source = ordinarySource();
            if (source && disposable?.contribution)
              await runtime.registrationForActor(disposable.contribution, source).dispose();
          } catch (error) {
            log.error(`source-aware dispose from "${manifest.id}" failed`, error);
          }
          try {
            disposable?.dispose();
          } catch (error) {
            log.error(`dispose from "${manifest.id}" failed`, error);
          }
          return;
        }

        case "quiesced":
          acknowledgeQuiescence?.(message.error);
          return;

        case "deactivated":
          acknowledgeDeactivation?.();
          return;

        case "cancel":
          incomingCalls.get(message.id)?.controller.abort(new AppError("plugin/cancelled", "Plugin call cancelled"));
          return;

        case "call": {
          const source = ordinarySource();
          if (incomingCalls.has(message.id)) return;
          if (incomingCalls.size >= 256) {
            releaseCallbacks(message.args);
            post({
              t: "result",
              id: message.id,
              ok: false,
              code: "plugin/busy",
              error: "Too many pending plugin calls",
            });
            return;
          }
          const controller = new AbortController();
          let finish!: () => void;
          const settled = new Promise<void>((resolve) => {
            finish = resolve;
          });
          let argumentOwner: HeldRegistration | undefined;
          let callLease: BudgetLease | undefined;
          let registrationLease: BudgetLease | undefined;
          let releaseArguments = () => releaseCallbacks(message.args);
          incomingCalls.set(message.id, { controller, settled });
          const timeout = setTimeout(
            () => controller.abort(new AppError("plugin/timeout", "Plugin call timed out")),
            120_000,
          );
          controller.signal.addEventListener("abort", () => clearTimeout(timeout), { once: true });
          try {
            callLease = pluginHostBudget.reserve("calls");
            registrationLease = pluginHostBudget.reserve("registrations");
            // Reserve for every in-flight call before invoking anything: a rejected
            // replacement registration must not displace the currently live one.
            if (heldDisposables.size + incomingCalls.size > PLUGIN_WIRE_LIMITS.disposables) {
              throw new AppError("plugin/busy", "Plugin disposable capacity exceeded");
            }
            if (callAdmissionClosed || (quiescing && !message.method.startsWith("services.storage."))) {
              throw new AppError("plugin/cancelled", "Plugin runtime is stopping");
            }
            const resolve = (target: PluginContext) =>
              message.method === "$registration.updateState"
                ? (...params: unknown[]) => {
                    runtime.lifecycle.assertActive("contribution.updateState");
                    const [handle, state] = params;
                    if (typeof handle !== "string")
                      throw new AppError("plugin/invalid-input", "Registration handle must be a string");
                    const registration = heldDisposables.get(handle);
                    if (!registration) return { status: "inactive" };
                    if (!registration.updateState)
                      throw new AppError("plugin/unavailable", "Registration has no action state");
                    if (message.reaction) {
                      if (!registration.contribution)
                        throw new AppError("plugin/invalid-cause", "Handle is not a contribution registration");
                      return runtime.context
                        .withEvent(
                          { reaction: message.reaction },
                          registration.contribution as PluginActionRegistration,
                        )
                        .updateState(state as Parameters<PluginActionRegistration["updateState"]>[0]);
                    }
                    if (source && registration.contribution)
                      return runtime
                        .registrationForActor(registration.contribution as PluginActionRegistration, source)
                        .updateState(state as Parameters<PluginActionRegistration["updateState"]>[0]);
                    return registration.updateState(state as Parameters<PluginActionRegistration["updateState"]>[0]);
                  }
                : message.method === "$registration.dispose"
                  ? async (...params: unknown[]) => {
                      runtime.lifecycle.assertActive("contribution.dispose");
                      const [handle] = params;
                      if (params.length !== 1 || typeof handle !== "string")
                        throw new AppError("plugin/invalid-input", "Expected one registration handle");
                      const registration = heldDisposables.get(handle);
                      if (!registration) return;
                      if (!registration.contribution)
                        throw new AppError("plugin/invalid-cause", "Handle is not a contribution registration");
                      if (message.reaction)
                        await runtime.context
                          .withEvent({ reaction: message.reaction }, registration.contribution)
                          .dispose();
                      else if (source) await runtime.registrationForActor(registration.contribution, source).dispose();
                      // Release callback ownership after successful source-aware retirement.
                      heldDisposables.delete(handle);
                      registration.dispose();
                    }
                  : message.method === "withEvent"
                    ? null
                    : resolveMethod(target, message.method);
            if (
              options.serviceExecution &&
              (message.method.startsWith("contributions.") || message.method.startsWith("$registration."))
            ) {
              throw new AppError(
                "plugin/service-forbidden",
                "Service executions cannot register activation contributions",
              );
            }
            const method = message.reaction
              ? (...args: unknown[]) =>
                  runtime.reactions.execute(message.reaction!, async (actor) => {
                    if (options.restoreStorage)
                      throw new AppError("plugin/invalid-cause", "Migration cannot react to events");
                    const bound = resolve(runtime.contextForActor(actor));
                    if (!bound)
                      throw new AppError(
                        "plugin/unavailable",
                        `"${message.method}" is not granted to plugin "${manifest.id}"`,
                      );
                    return bound(...args);
                  })
              : resolve(source ? activationContext : ctx);
            if (!method)
              throw new AppError("plugin/unavailable", `"${message.method}" is not granted to plugin "${manifest.id}"`);
            const callbackLease = callbackBudget.acquire(message.args);
            releaseArguments = () => {
              callbackLease.dispose();
              releaseCallbacks(message.args);
            };
            const invokeCallback = pluginCallbackInvoker(message.method, invokeHandle);
            const args = decodePluginCallbacks(
              message.args,
              invokeCallback,
              (handles) => {
                callbackLease.release(handles);
                if (!terminated) post({ t: "release", handles });
              },
              runtime.lifecycle.signal,
            );
            // Ordinary consumers may retain a normalized subgraph (live view updates).
            // Registrations transfer this entire lease to their returned disposable.
            releaseArguments = retainPluginCallbacks(args);
            if (!Array.isArray(args))
              throw new AppError("plugin/invalid-input", "Plugin call arguments must be an array");
            injectPluginCallSignal(message.method, args, controller.signal);
            if (message.method === "services.network.fetch" || message.method === "services.network.openStream") {
              // Validate the body limit on the authoritative side too: a plugin
              // can send messages directly rather than use its friendly proxy.
              const request = await flattenPluginRequest(args[0] as RequestInfo | URL, {
                ...(args[1] as RequestInit | undefined),
                signal: controller.signal,
              });
              args[0] = request.url;
              args[1] = { ...request.init, signal: controller.signal };
            }
            if (message.method === "services.llm.ask" || message.method === "services.llm.askDetailed") {
              args[0] = { ...(args[0] as object), signal: controller.signal };
            }
            let value = await method(...args);
            if (value instanceof Response) value = await flattenPluginResponse(value, controller.signal);
            // A registration answers with a disposable, which cannot be cloned:
            // hold it and send back the handle the Worker releases it by.
            if (value && typeof value === "object" && typeof (value as PluginDisposable).dispose === "function") {
              if (heldDisposables.size >= PLUGIN_WIRE_LIMITS.disposables) {
                (value as PluginDisposable).dispose();
                throw new AppError("plugin/busy", "Plugin disposable capacity exceeded");
              }
              if (terminated || controller.signal.aborted) {
                (value as PluginDisposable).dispose();
                throw controller.signal.reason ?? new AppError("plugin/unavailable", "Plugin runtime stopped");
              }
              const handle = `d${nextDisposableId++}`;
              const registration = value as PluginDisposable;
              const retainedLease = registrationLease;
              registrationLease = undefined;
              let disposed = false;
              argumentOwner = {
                ...(message.method.startsWith("contributions.") && message.method.endsWith(".register")
                  ? { contribution: registration }
                  : {}),
                dispose() {
                  if (disposed) return;
                  disposed = true;
                  try {
                    registration.dispose();
                  } finally {
                    try {
                      releaseArguments();
                    } finally {
                      retainedLease.release();
                    }
                  }
                },
              };
              if (
                actionRegistrations.has(message.method) &&
                typeof (registration as HeldRegistration).updateState === "function"
              ) {
                argumentOwner.updateState = (state) =>
                  disposed
                    ? Promise.resolve({ status: "inactive" })
                    : (registration as PluginActionRegistration).updateState(state);
              }
              heldDisposables.set(handle, argumentOwner);
              try {
                post({ t: "result", id: message.id, ok: true, value: null, disposable: handle });
              } catch (error) {
                heldDisposables.delete(handle);
                argumentOwner.dispose();
                throw error;
              }
              return;
            }
            if (options.restoreStorage && message.method.startsWith("services.storage.")) {
              post({ t: "sync", patch: { storage: storageSnapshot() } });
            }
            post({ t: "result", id: message.id, ok: true, value: value ?? null });
          } catch (error) {
            const failure =
              controller.signal.aborted && !pluginCallDrainsCancellation(message.method)
                ? controller.signal.reason
                : error;
            if (message.method.startsWith("services.network.") && !controller.signal.aborted) {
              log.warn("Plugin network request failed", manifest.id, message.method, failure);
            }
            post({
              t: "result",
              id: message.id,
              ok: false,
              error: failure instanceof Error ? failure.message : String(failure),
              // Stable codes (AppError) survive the boundary as data — the
              // worker rebuilds an Error carrying `code`, so a plugin rethrow
              // keeps it and the host can render code-specific copy.
              code: errorCode(failure),
            });
          } finally {
            // Streaming callbacks belong to the call; registration callbacks
            // belong to the returned disposable, not the plugin's entire lifetime.
            try {
              if (!argumentOwner) releaseArguments();
            } finally {
              try {
                registrationLease?.release();
                callLease?.release();
              } finally {
                clearTimeout(timeout);
                incomingCalls.delete(message.id);
                finish();
              }
            }
          }
          return;
        }

        case "result": {
          if (message.ok) {
            let callbackLease: ReturnType<PluginCallbackBudget["acquire"]> | undefined;
            try {
              if (!pendingInvokes.has(message.id)) {
                releaseCallbacks(message.value);
                return;
              }
              callbackLease = callbackBudget.acquire(message.value);
              const acceptedLease = callbackLease;
              const value = decodePluginCallbacks(
                message.value,
                invokeHandle,
                (handles) => {
                  acceptedLease.release(handles);
                  if (!terminated) post({ t: "release", handles });
                },
                runtime.lifecycle.signal,
              );
              pendingInvokes.settle(message.id, true, value);
            } catch (error) {
              callbackLease?.dispose();
              releaseCallbacks(message.value);
              pendingInvokes.settle(message.id, false, error);
            }
          } else
            pendingInvokes.settle(
              message.id,
              false,
              message.code ? new AppError(message.code, message.error) : new Error(message.error),
            );
          return;
        }

        case "healthy": {
          const pending = pendingHealth.get(message.id);
          if (!pending) return;
          pendingHealth.delete(message.id);
          clearTimeout(pending.timeout);
          pending.resolve();
          return;
        }

        case "migrated": {
          const pending = pendingMigrations.get(message.id);
          if (!pending) return;
          pendingMigrations.delete(message.id);
          clearTimeout(pending.timeout);
          runtime.lifecycle.finishMigration();
          try {
            post({ t: "sync", patch: { phase: "activating" } });
          } catch (error) {
            pending.reject(error instanceof Error ? error : new Error(String(error)));
            failRuntime(error instanceof Error ? error.message : String(error), pending.source);
            return;
          }
          if (message.ok) pending.resolve();
          else pending.reject(new Error(message.error));
          return;
        }
      }
    };

    try {
      post({
        t: "boot",
        protocolVersion: PLUGIN_PROTOCOL_VERSION,
        url: options.moduleUrl ?? pluginModuleUrl(manifest.id, manifest.main ?? "main.js"),
        manifest,
        appVersion,
        capabilities: ctx.capabilities,
        grants: ctx.grants,
        shape: describeContext(ctx),
        storage: storageSnapshot(),
        locale: ctx.locale,
        phase: runtime.lifecycle.phase,
        ...(options.serviceExecution ? { serviceId: options.serviceExecution.declaration.id } : {}),
      });
    } catch (error) {
      failRuntime(error instanceof Error ? error.message : String(error));
    }
  });
}
