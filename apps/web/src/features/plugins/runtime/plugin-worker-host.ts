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
} from "@read-aware/plugin-types";
import { AppError, errorCode } from "@read-aware/core";
import { buildPluginContext, currentAppLocale, pluginStoragePrefix } from "./plugin-context";
import { pluginModuleUrl } from "./plugin-backend";
import { i18n } from "../../../i18n";
import { onAppEvent } from "../../../platform/app-events";
import { localKV, onLocalKVChange } from "../../../platform/local-store";
import { createLogger } from "../../../platform/logger";
import { updateInstalledPlugin } from "../state/plugin-store";
import { flattenPluginRequest, flattenPluginResponse } from "./plugin-network-wire";
import { PluginRpcPending } from "./plugin-rpc-pending";
import { decodePluginCallbacks, type PluginCallbackWire } from "./plugin-callback-wire";

const log = createLogger("plugins");

type WorkerMessage =
  | { t: "ready"; hasMigration: boolean }
  | { t: "failed"; error: string }
  | { t: "dispose"; handle: string }
  | { t: "call"; id: number; method: string; args: PluginCallbackWire }
  | { t: "cancel"; id: number }
  | { t: "result"; id: number; ok: true; value: PluginCallbackWire }
  | { t: "result"; id: number; ok: false; error: string; code?: string }
  | { t: "healthy"; id: number }
  | { t: "migrated"; id: number; ok: true }
  | { t: "migrated"; id: number; ok: false; error: string }
  | { t: "quiesced"; error?: string };

export type SandboxedPlugin = {
  manifest: PluginManifest;
  readonly hasMigration: boolean;
  checkHealth(): Promise<void>;
  migrate(migration: PluginMigration): Promise<void>;
  promote(): void;
  terminate(): Promise<void>;
};

export type StartPluginWorkerOptions = {
  /** Alternate entry URL for a separately staged update candidate. */
  moduleUrl?: string;
  /** Distinguishes two simultaneous versions of one plugin. */
  instanceId?: string;
  /** Candidate failures must not overwrite the installed version's status. */
  onRuntimeError?: (message: string) => void;
};

// ─── Host → worker state sync ────────────────────────────────────────────────
//
// The worker keeps local mirrors so `storage.get()` and `ctx.locale` stay
// synchronous. Worker-side writes already flow back here; this is the other
// direction: when the HOST changes (a settings edit from the Plugins panel,
// the app language switching), every live sandbox gets a `sync` patch, or
// its mirror silently serves boot-time values forever.

const liveWorkers = new Map<string, { pluginId: string; worker: Worker }>();
let syncWired = false;

function wireHostSync(): void {
  if (syncWired) return;
  syncWired = true;
  onLocalKVChange((key) => {
    for (const { pluginId, worker } of liveWorkers.values()) {
      const prefix = pluginStoragePrefix(pluginId);
      if (key.startsWith(prefix)) worker.postMessage({ t: "sync", patch: { storage: localKV.entries(prefix) } });
    }
  });
  onAppEvent("plugin-storage-changed", ({ pluginId }) => {
    for (const live of liveWorkers.values()) {
      if (live.pluginId !== pluginId) continue;
      live.worker.postMessage({
        t: "sync",
        patch: { storage: localKV.entries(pluginStoragePrefix(pluginId)) },
      });
    }
  });
  i18n.on("languageChanged", () => {
    const locale = currentAppLocale();
    for (const { worker } of liveWorkers.values()) {
      worker.postMessage({ t: "sync", patch: { locale } });
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
function resolveMethod(
  ctx: PluginContext,
  method: string,
): ((...args: unknown[]) => unknown) | null {
  // Own enumerable properties of plain objects only — the context is built
  // entirely from literals, so anything reachable via the prototype chain
  // (`constructor` and friends) is by definition not part of the granted
  // surface and must not resolve.
  const step = (target: unknown, key: string): unknown =>
    target !== null &&
    typeof target === "object" &&
    Object.prototype.hasOwnProperty.call(target, key)
      ? (target as Record<string, unknown>)[key]
      : undefined;
  const collection = method.match(
    /^services\.storage\.collection\(([^)]*)\)\.(\w+)$/,
  );
  if (collection) {
    const api = ctx.services.storage.collection(
      collection[1],
    ) as unknown as Record<string, unknown>;
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
  return typeof fn === "function"
    ? (fn as (...a: unknown[]) => unknown).bind(target)
    : null;
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
export type ContextShape = { [key: string]: "fn" | ContextShape };

/** Data (not callables) the Worker mirrors locally to keep sync reads sync. */
const SHAPE_SKIP = new Set(["manifest", "appVersion", "locale", "lifecycle", "capabilities"]);

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
    shape.__collection = describeShape(
      ctx.services.storage.collection("probe"),
      1,
    );
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
  const worker = new Worker(new URL("./plugin-sandbox.worker.ts", import.meta.url), {
    type: "module",
    name: `plugin:${manifest.id}`,
  });
  const instanceId = options.instanceId ?? manifest.id;
  wireHostSync();
  liveWorkers.set(instanceId, { pluginId: manifest.id, worker });
  const runtime = buildPluginContext(manifest, appVersion, disposables);
  const ctx = runtime.context;
  let terminated = false;
  let quiescing = false;
  let termination: Promise<void> | undefined;
  let acknowledgeQuiescence: ((error?: string) => void) | undefined;

  const pendingInvokes = new PluginRpcPending();
  const incomingCalls = new Map<number, AbortController>();
  const abortIncomingCalls = () => {
    for (const controller of incomingCalls.values()) controller.abort(new AppError("plugin/cancelled", "Plugin runtime stopped"));
  };
  let nextHealthId = 1;
  const pendingHealth = new Map<
    number,
    { resolve: () => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }
  >();
  let nextMigrationId = 1;
  const pendingMigrations = new Map<
    number,
    { resolve: () => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }
  >();
  /** A dead worker answers nothing — fail its in-flight calls, don't strand them. */
  const failAllInvokes = (reason: string) => {
    pendingInvokes.failAll(new AppError("plugin/unavailable", reason));
  };
  const failAllHealthChecks = (reason: string) => {
    for (const pending of pendingHealth.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
    }
    pendingHealth.clear();
  };
  const failAllMigrations = (reason: string) => {
    for (const pending of pendingMigrations.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
    }
    pendingMigrations.clear();
  };
  /** Call a function the plugin kept inside the Worker. */
  const invokeHandle = (handle: string, args: unknown[]): Promise<unknown> => {
    return pendingInvokes.call(id => {
      worker.postMessage({ t: "invoke", id, handle, args });
    });
  };

  const releaseCallbacks = (wire: PluginCallbackWire) => {
    const handles = Array.isArray(wire?.callbacks)
      ? wire.callbacks.flatMap(entry => typeof entry?.handle === "string" ? [entry.handle] : []) : [];
    if (!terminated && handles.length) worker.postMessage({ t: "release", handles });
  };

  /**
   * Disposables the plugin is holding. A `PluginDisposable` cannot be cloned, so
   * the Worker gets a handle and releases it by sending that back.
   */
  const heldDisposables = new Map<string, PluginDisposable>();
  let nextDisposableId = 1;

  return new Promise<SandboxedPlugin>((resolve, reject) => {
    let settled = false;
    const activationTimeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      liveWorkers.delete(instanceId);
      worker.terminate();
      failAllInvokes(`plugin "${manifest.id}" activation timed out`);
      reject(new Error("plugin activation timed out"));
    }, 10_000);

    worker.onerror = (event) => {
      if (settled) {
        // A crash after activation used to vanish here; keep the sandbox up
        // (its registrations may still work) but put the error where the
        // settings panel shows it.
        const message = event.message || "plugin crashed at runtime";
        log.error(`runtime error in "${manifest.id}"`, message);
        failAllInvokes(message);
        failAllHealthChecks(message);
        failAllMigrations(message);
        if (options.onRuntimeError) options.onRuntimeError(message);
        else updateInstalledPlugin(manifest.id, { error: message });
        return;
      }
      settled = true;
      clearTimeout(activationTimeout);
      liveWorkers.delete(instanceId);
      worker.terminate();
      failAllMigrations(`plugin "${manifest.id}" failed to start`);
      reject(new Error(event.message || "plugin worker failed to start"));
    };

    worker.onmessage = async (event: MessageEvent<WorkerMessage>) => {
      if (terminated) return;
      const message = event.data;
      switch (message.t) {
        case "ready":
          if (!settled) {
            settled = true;
            clearTimeout(activationTimeout);
            resolve({
              manifest,
              hasMigration: message.hasMigration,
              checkHealth() {
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
                  worker.postMessage({ t: "health", id });
                });
              },
              migrate(migration) {
                runtime.lifecycle.beginMigration();
                worker.postMessage({ t: "sync", patch: { phase: "migrating", storage: localKV.entries(pluginStoragePrefix(manifest.id)) } });
                const id = nextMigrationId++;
                return new Promise<void>((migrationResolve, migrationReject) => {
                  const timeout = setTimeout(() => {
                    pendingMigrations.delete(id);
                    runtime.lifecycle.finishMigration();
                    worker.postMessage({ t: "sync", patch: { phase: "activating" } });
                    migrationReject(new Error("plugin data migration timed out"));
                  }, 30_000);
                  pendingMigrations.set(id, {
                    resolve: migrationResolve,
                    reject: migrationReject,
                    timeout,
                  });
                  worker.postMessage({ t: "migrate", id, migration });
                });
              },
              promote() {
                worker.postMessage({ t: "sync", patch: { phase: "active" } });
                try {
                  runtime.lifecycle.promote();
                } catch (error) {
                  worker.postMessage({ t: "sync", patch: { phase: "activating" } });
                  throw error;
                }
              },
              terminate() {
                return termination ??= (async () => {
                  quiescing = true;
                  runtime.lifecycle.cancelOperations();
                  abortIncomingCalls();
                  // This message barrier lets already-issued Worker writes reach
                  // the host before it closes the gate and drains native writes.
                  const quiescenceError = await new Promise<string | undefined>(done => {
                    const timeout = setTimeout(() => done("plugin quiescence timed out"), 2_000);
                    acknowledgeQuiescence = error => { clearTimeout(timeout); done(error); };
                    worker.postMessage({ t: "quiesce" });
                  });
                  acknowledgeQuiescence = undefined;
                  // Retire migration timers/results before closing the lifecycle:
                  // a late response must not reopen (or throw from) a stopped realm.
                  failAllMigrations(`plugin "${manifest.id}" was deactivated`);
                  try {
                    const errors: unknown[] = [];
                    try { runtime.lifecycle.stop(); }
                    catch (error) { errors.push(error); }
                    try { await runtime.lifecycle.drainStorageWrites(); }
                    catch (error) { errors.push(error); }
                    if (quiescenceError) errors.push(new Error(quiescenceError));
                    if (errors.length === 1) throw errors[0];
                    if (errors.length > 1) throw new AggregateError(errors, "Plugin shutdown failed");
                  } finally {
                    worker.postMessage({ t: "deactivate" });
                    await new Promise(done => setTimeout(done, 50));
                    terminated = true;
                    pendingInvokes.close(new AppError("plugin/unavailable", "Plugin runtime stopped"));
                    const live = liveWorkers.get(instanceId);
                    if (live?.worker === worker) liveWorkers.delete(instanceId);
                    worker.terminate();
                    heldDisposables.clear();
                    failAllInvokes(`plugin "${manifest.id}" was deactivated`);
                    failAllHealthChecks(`plugin "${manifest.id}" was deactivated`);
                    failAllMigrations(`plugin "${manifest.id}" was deactivated`);
                  }
                })();
              },
            });
          }
          return;

        case "failed":
          if (!settled) {
            settled = true;
            clearTimeout(activationTimeout);
            liveWorkers.delete(instanceId);
            worker.terminate();
            failAllInvokes(`plugin "${manifest.id}" failed to start`);
            reject(new Error(message.error));
          }
          return;

        case "dispose": {
          const disposable = heldDisposables.get(message.handle);
          heldDisposables.delete(message.handle);
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

        case "cancel":
          incomingCalls.get(message.id)?.abort(new AppError("plugin/cancelled", "Plugin call cancelled"));
          return;

        case "call": {
          if (incomingCalls.has(message.id)) return;
          if (incomingCalls.size >= 256) {
            releaseCallbacks(message.args);
            worker.postMessage({ t: "result", id: message.id, ok: false, code: "plugin/busy", error: "Too many pending plugin calls" });
            return;
          }
          const controller = new AbortController();
          let argumentOwner: PluginDisposable | undefined;
          incomingCalls.set(message.id, controller);
          const timeout = setTimeout(() => controller.abort(new AppError("plugin/timeout", "Plugin call timed out")), 120_000);
          controller.signal.addEventListener("abort", () => clearTimeout(timeout), { once: true });
          try {
            if (quiescing && !message.method.startsWith("services.storage.")) {
              throw new AppError("plugin/cancelled", "Plugin runtime is stopping");
            }
            const method = resolveMethod(ctx, message.method);
            if (!method) throw new AppError("plugin/unavailable", `"${message.method}" is not granted to plugin "${manifest.id}"`);
            const args = decodePluginCallbacks(message.args, invokeHandle);
            if (!Array.isArray(args)) throw new AppError("plugin/invalid-input", "Plugin call arguments must be an array");
            if (message.method === "services.network.fetch") {
              // Validate the body limit on the authoritative side too: a plugin
              // can send messages directly rather than use its friendly proxy.
              const request = await flattenPluginRequest(args[0] as RequestInfo | URL, { ...(args[1] as RequestInit | undefined), signal: controller.signal });
              args[0] = request.url;
              args[1] = { ...request.init, signal: controller.signal };
            }
            let value = await method(...args);
            if (value instanceof Response) value = await flattenPluginResponse(value, controller.signal);
            // A registration answers with a disposable, which cannot be cloned:
            // hold it and send back the handle the Worker releases it by.
            if (
              value &&
              typeof value === "object" &&
              typeof (value as PluginDisposable).dispose === "function"
            ) {
              if (terminated || controller.signal.aborted) {
                (value as PluginDisposable).dispose();
                throw controller.signal.reason ?? new AppError("plugin/unavailable", "Plugin runtime stopped");
              }
              const handle = `d${nextDisposableId++}`;
              const registration = value as PluginDisposable;
              let disposed = false;
              argumentOwner = {
                dispose() {
                  if (disposed) return;
                  disposed = true;
                  try { registration.dispose(); }
                  finally { releaseCallbacks(message.args); }
                },
              };
              heldDisposables.set(handle, argumentOwner);
              try {
                worker.postMessage({ t: "result", id: message.id, ok: true, value: null, disposable: handle });
              } catch (error) {
                heldDisposables.delete(handle);
                argumentOwner.dispose();
                throw error;
              }
              return;
            }
            worker.postMessage({ t: "result", id: message.id, ok: true, value: value ?? null });
          } catch (error) {
            const failure = controller.signal.aborted ? controller.signal.reason : error;
            worker.postMessage({
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
            if (!argumentOwner) releaseCallbacks(message.args);
            clearTimeout(timeout);
            incomingCalls.delete(message.id);
          }
          return;
        }

        case "result": {
          if (message.ok) {
            try {
              if (!pendingInvokes.has(message.id)) {
                releaseCallbacks(message.value);
                return;
              }
              const value = decodePluginCallbacks(message.value, invokeHandle);
              pendingInvokes.settle(message.id, true, value);
            } catch (error) {
              releaseCallbacks(message.value);
              pendingInvokes.settle(message.id, false, error);
            }
          } else
            pendingInvokes.settle(message.id, false,
              message.code
                ? new AppError(message.code, message.error)
                : new Error(message.error),
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
          worker.postMessage({ t: "sync", patch: { phase: "activating" } });
          if (message.ok) pending.resolve();
          else pending.reject(new Error(message.error));
          return;
        }
      }
    };

    worker.postMessage({
      t: "boot",
      url: options.moduleUrl ?? pluginModuleUrl(manifest.id, manifest.main ?? "main.js"),
      manifest,
      appVersion,
      capabilities: ctx.capabilities,
      shape: describeContext(ctx),
      storage: localKV.entries(pluginStoragePrefix(manifest.id)),
      locale: ctx.locale,
      phase: runtime.lifecycle.phase,
    });
  });
}
