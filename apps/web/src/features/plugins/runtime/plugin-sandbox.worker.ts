/**
 * The plugin sandbox: a module Worker that runs ONE plugin's code.
 *
 * Plugins used to be `import()`ed straight into the app's realm, which handed
 * every one of them the app's own authority — `window.__TAURI_INTERNALS__` is
 * reachable from there, so a plugin declaring zero permissions could still call
 * any Tauri command and read the whole library, the event log, and the API key.
 * The manifest permission list was a courtesy, not a boundary.
 *
 * In here there is no `window`, no `document`, and no `__TAURI_INTERNALS__`.
 * Host calls go through `postMessage` and manifest checks. The worker response
 * also carries its own CSP: ambient network and child workers are forbidden,
 * and module loading is limited to host/plugin assets. Global getters below
 * provide friendly errors, not an isolation boundary (native methods may also
 * exist on prototypes). See plugin-sandbox-policy.json and its native/Vite hooks.
 *
 * Two shapes have to survive the realm crossing:
 *
 *   - **Synchronous reads.** `storage.get()` and `ctx.locale` are synchronous
 *     in the plugin API and stay that way: the host ships a snapshot before
 *     `activate()` and pushes updates after, so the answer is always local.
 *     Plugin source needs no change for this.
 *   - **Callbacks.** A registration carries functions (`run`, `segmentText`),
 *     which cannot be cloned. They stay here; the host gets a serializable
 *     description plus a handle and calls back through `invoke`.
 */
// A worker is its own realm: plugin code gets the same ES2024 floor the host
// guarantees itself, so the import stays first.
import "../../../platform/polyfills";
import { preparePluginCall, pluginCallDrainsCancellation } from "./plugin-call-options";
import type {
  PluginActionRegistration,
  PluginActionStateReceipt,
  PluginContext,
  PluginReactionToken,
  PluginManifest,
  PluginMigrationContext,
  PluginModule,
} from "@read-aware/plugin-types";
import { PluginStorageMirror } from "./plugin-storage-mirror";
import { flattenPluginRequest, restorePluginResponse, type PluginNetworkResponse } from "./plugin-network-wire";
import { pluginNetworkAbort, pluginNetworkError } from "./plugin-network-error";
import { PluginRpcPending } from "./plugin-rpc-pending";
import { PluginCallbackRegistry } from "./plugin-callback-wire";
import {
  parsePluginWorkerMessage,
  PLUGIN_PROTOCOL_VERSION,
  validPluginCallId,
  type WorkerMessage,
} from "./plugin-worker-protocol";
import { parsePluginHostMessage, type HostMessage, type ContextShape } from "./plugin-host-protocol";

// ─── Wire protocol ───────────────────────────────────────────────────────────

const post = (input: WorkerMessage) => {
  if (stopped && input.t !== "failed") throw codedError("Plugin runtime stopped", "plugin/unavailable");
  const message =
    "error" in input && typeof input.error === "string" ? { ...input, error: input.error.slice(0, 4096) } : input;
  self.postMessage(parsePluginWorkerMessage(message));
};

/**
 * Stable error codes (see @read-aware/core errors.ts) survive the boundary as
 * a plain `code` field: Error instances lose custom properties to structured
 * clone, so both failure directions carry the code explicitly and rebuild it.
 */
const codeOf = (error: unknown): string | undefined => {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string" && code.length > 0 && code.length <= 256) return code;
  }
  return undefined;
};

const codedError = (message: string, code?: string): Error =>
  code ? Object.assign(new Error(message), { code }) : new Error(message);

function denyAmbientAuthority(name: string): void {
  try {
    Object.defineProperty(globalThis, name, {
      configurable: false,
      get() {
        throw new Error(`${name} is unavailable in the plugin sandbox; use PluginContext`);
      },
    });
  } catch {
    // Some engines have non-configurable globals. The response CSP and host
    // authorization, not this best-effort diagnostic getter, enforce access.
  }
}

for (const name of ["fetch", "WebSocket", "EventSource", "XMLHttpRequest", "BroadcastChannel", "indexedDB", "caches"]) {
  denyAmbientAuthority(name);
}

// ─── Host calls (plugin → host, async) ───────────────────────────────────────

const pendingCalls = new PluginRpcPending();
const inFlightHostCalls = new Set<Promise<unknown>>();
const lifecycleCallErrors: unknown[] = [];

// ─── Crossing the boundary with functions in tow ─────────────────────────────

const callbacks = new PluginCallbackRegistry();

/**
 * A call's result, which has to satisfy two shapes at once.
 *
 * Most context methods are async, but the registration methods return a
 * `PluginDisposable` SYNCHRONOUSLY — and a synchronous return cannot cross a
 * realm. So every call hands back something that is both awaitable and
 * disposable: `await ctx.books.list()` resolves to the data, and
 * `ctx.contributions.commands.register(...).dispose()` works on the object it got back, with
 * the release travelling once the host answers.
 */
type CallResult = Promise<unknown> & PluginActionRegistration;
const contributionBindings = new WeakMap<
  object,
  (token: PluginReactionToken) => import("@read-aware/plugin-types").PluginEventRegistration<PluginActionRegistration>
>();

function callHost(method: string, args: unknown[], signal?: AbortSignal, reaction?: PluginReactionToken): CallResult {
  const prepared = preparePluginCall(method, args);
  args = prepared.args;
  signal ??= prepared.signal;
  const receipt = pendingCalls.call(
    (id) => {
      callbacks.send(args, (wire) => post({ t: "call", id, method, args: wire, ...(reaction ? { reaction } : {}) }));
    },
    { signal, cancel: (id) => post({ t: "cancel", id }), drainCancellation: pluginCallDrainsCancellation(method) },
  );
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    void receipt
      .then((value) => {
        const { disposable } = value as { disposable?: string };
        if (disposable) post({ t: "dispose", handle: disposable });
      })
      .catch(() => {
        // Failed calls have no registration to dispose; the host releases arguments.
      });
  };
  const updateState: PluginActionRegistration["updateState"] = async (state) => {
    if (disposed) return { status: "inactive" };
    const response = (await receipt) as { disposable?: string };
    if (disposed) return { status: "inactive" };
    if (!response.disposable) throw codedError("Call did not create a registration", "plugin/unavailable");
    return (await callHost("$registration.updateState", [response.disposable, state])) as PluginActionStateReceipt;
  };
  const bind = (token: PluginReactionToken) => {
    const bound = {
      dispose: async () => {
        const response = (await receipt) as { disposable?: string };
        if (!response.disposable) throw codedError("Call did not create a registration", "plugin/unavailable");
        await callHost("$registration.dispose", [response.disposable], undefined, token);
        disposed = true;
      },
      updateState: async (state: Parameters<PluginActionRegistration["updateState"]>[0]) => {
        const response = (await receipt) as { disposable?: string };
        if (!response.disposable) throw codedError("Call did not create a registration", "plugin/unavailable");
        return (await callHost(
          "$registration.updateState",
          [response.disposable, state],
          undefined,
          token,
        )) as PluginActionStateReceipt;
      },
    };
    contributionBindings.set(bound, bind);
    return bound;
  };
  const isContribution = method.startsWith("contributions.") && method.endsWith(".register");
  const promise = receipt.then((value) => {
    const response = value as { value: unknown; disposable?: string };
    if (!response.disposable) return response.value;
    const handle = { dispose, updateState };
    if (isContribution) contributionBindings.set(handle, bind);
    return handle;
  });
  inFlightHostCalls.add(promise);
  void promise.then(
    () => inFlightHostCalls.delete(promise),
    (error) => {
      inFlightHostCalls.delete(promise);
      if (lifecyclePhase !== "active" && codeOf(error) !== "plugin/cancelled") lifecycleCallErrors.push(error);
    },
  );
  const result = promise as CallResult;
  result.dispose = dispose;
  result.updateState = updateState;
  if (isContribution) contributionBindings.set(result, bind);
  return result;
}

/**
 * Build a namespace from the host's description: every leaf becomes a method
 * that round-trips to the permission check on the far side. Nothing is
 * hand-listed, so the sandbox always exposes exactly what the host granted —
 * including nested namespaces like `books.write`.
 */
function remoteNamespace(path: string, shape: ContextShape, reaction?: PluginReactionToken): Record<string, unknown> {
  const api: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(shape)) {
    const method = path ? `${path}.${key}` : key;
    api[key] =
      entry === "fn"
        ? (...args: unknown[]) => callHost(method, args, undefined, reaction)
        : remoteNamespace(method, entry, reaction);
  }
  return api;
}

// ─── Locally-mirrored state (keeps the sync API sync) ────────────────────────

const storageSnapshot = new PluginStorageMirror();
let appLocale = "";
let lifecyclePhase: PluginContext["lifecycle"]["phase"] = "activating";
const activationLifecycle = Object.freeze({
  get phase() {
    return lifecyclePhase;
  },
});

function assertLocalStorageWrite(): void {
  if (lifecyclePhase !== "active" && lifecyclePhase !== "migrating") {
    throw new Error(`plugin storage writes are unavailable while plugin is ${lifecyclePhase}`);
  }
}

async function drainActivationCalls(): Promise<void> {
  while (inFlightHostCalls.size > 0) {
    const results = await Promise.allSettled([...inFlightHostCalls]);
    const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed && codeOf(failed.reason) !== "plugin/cancelled") throw failed.reason;
  }
  const failed = lifecycleCallErrors.shift();
  lifecycleCallErrors.length = 0;
  if (failed) throw failed;
}

// ─── Context assembly ────────────────────────────────────────────────────────

function buildContext(
  manifest: PluginManifest,
  appVersion: string,
  capabilities: PluginContext["capabilities"],
  grants: PluginContext["grants"],
  shape: ContextShape,
  reaction?: PluginReactionToken,
): PluginContext {
  const { __collection: collectionShape = {}, ...namespaces } = shape;

  // Everything the host granted, proxied verbatim.
  const ctx = remoteNamespace("", namespaces as ContextShape, reaction) as Record<string, unknown>;

  const call = (method: string, args: unknown[], signal?: AbortSignal) => callHost(method, args, signal, reaction);
  ctx.withEvent = (
    event: import("@read-aware/plugin-types").PluginReactionEvent | undefined,
    registration?: object,
  ) => {
    if (!event?.reaction) throw codedError("Event has no reaction lease", "plugin/invalid-cause");
    const token = Object.freeze({ ...event.reaction });
    if (token.status === "cycle") throw codedError("Event reaction would repeat a causal step", "plugin/event-cycle");
    if (registration !== undefined) {
      const bind = registration && contributionBindings.get(registration);
      if (!bind) throw codedError("Not an owned contribution registration", "plugin/invalid-cause");
      return bind(token);
    }
    return buildContext(manifest, appVersion, capabilities, grants, shape, token);
  };
  ctx.manifest = manifest;
  ctx.appVersion = appVersion;
  ctx.capabilities = capabilities;
  // The grant is activation metadata, not an RPC namespace. Keep a frozen
  // copy in the Worker so plugin code cannot widen or rewrite host authority.
  const bookGrant =
    grants.book.mode === "book" ? { mode: "book" as const, bookId: grants.book.bookId } : { mode: grants.book.mode };
  Object.defineProperty(ctx, "grants", {
    value: Object.freeze({ book: Object.freeze(bookGrant) }),
    enumerable: true,
    writable: false,
    configurable: false,
  });
  // Mirrored locally (boot + sync patches) so the read stays synchronous.
  Object.defineProperty(ctx, "locale", { get: () => appLocale, enumerable: true });
  ctx.lifecycle = activationLifecycle;

  // Storage: reads answer from the snapshot the host shipped at boot, so the
  // plugin-facing API stays synchronous. Writes update it locally and tell the
  // host, mirroring how `localKV` behaves on the other side.
  const services = ctx.services as Record<string, unknown>;
  services.storage = {
    policy: () => call("services.storage.policy", []),
    get<T = unknown>(key: string): T | null {
      if (serviceId && grants.book.mode !== "all")
        throw codedError("Book services cannot access unscoped private data", "plugin/service-forbidden");
      const raw = storageSnapshot.get(key);
      if (raw === undefined) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    },
    set(key: string, value: unknown): Promise<void> {
      assertLocalStorageWrite();
      const raw = JSON.stringify(value ?? null);
      const id = storageSnapshot.begin(key, raw);
      const pending = call("services.storage.set", [key, value]);
      void pending.then(
        () => storageSnapshot.settle(id),
        () => storageSnapshot.settle(id),
      );
      return pending as Promise<void>;
    },
    remove(key: string): Promise<void> {
      assertLocalStorageWrite();
      const id = storageSnapshot.begin(key, null);
      const pending = call("services.storage.remove", [key]);
      void pending.then(
        () => storageSnapshot.settle(id),
        () => storageSnapshot.settle(id),
      );
      return pending as Promise<void>;
    },
    getDurable: <T = unknown>(key: string) => call("services.storage.getDurable", [key]) as Promise<T | null>,
    flush: () => call("services.storage.flush", []),
    applyDocuments: (changes: import("@read-aware/plugin-types").PluginDocumentChange[]) => {
      assertLocalStorageWrite();
      return call("services.storage.applyDocuments", [changes]);
    },
    // Host-side writes (settings page, agent) arrive as a `sync` patch and
    // then as this notification — in that order, so the mirror the handler
    // reads from is already fresh. Settings-key writes may echo with a reaction token.
    onChange: (
      handler: Parameters<import("@read-aware/plugin-types").PluginStorage["onChange"]>[0],
      options?: Parameters<import("@read-aware/plugin-types").PluginStorage["onChange"]>[1],
    ) => call("services.storage.onChange", [handler, options]),
    observeDocuments: (
      query: import("@read-aware/plugin-types").PluginDocumentObservationQuery,
      handler: (event: import("@read-aware/plugin-types").PluginDocumentObservation) => unknown,
    ) => call("services.storage.observeDocuments", [query, handler]),
    collection: (name: string) =>
      remoteNamespace(`services.storage.collection(${name})`, collectionShape as ContextShape, reaction),
  };

  // `showToast` is fire-and-forget in the plugin API; don't hand back a promise.
  const ui = services.ui as Record<string, unknown> | undefined;
  if (ui && typeof ui.showToast === "function") {
    const call = ui.showToast as (message: string) => Promise<unknown>;
    ui.showToast = (message: string) => {
      void call(message);
    };
  }

  // `fetch` needs translation on BOTH sides of the crossing. The request may
  // carry platform objects postMessage cannot clone — a URL or Request as
  // input, a Headers instance, an AbortSignal — so it is flattened to plain
  // data here; the response comes back flattened (body as ArrayBuffer, so
  // binary payloads survive) and is rebuilt into a real Response.
  const network = services.network as Record<string, unknown> | undefined;
  for (const operation of ["fetch", "openStream"] as const) {
    if (!network || typeof network[operation] !== "function") continue;
    network[operation] = async (
      input: RequestInfo | URL,
      init?: RequestInit,
      options?: { retry?: "none" | "safe" },
    ) => {
      const acceptedOptions = options === undefined ? undefined : structuredClone(options);
      const request = await flattenPluginRequest(input, init);
      try {
        const result = await call(
          `services.network.${operation}`,
          [request.url, request.init, acceptedOptions],
          request.signal,
        );
        return operation === "fetch" ? restorePluginResponse(result as PluginNetworkResponse) : result;
      } catch (error) {
        throw request.signal.aborted ? pluginNetworkAbort(request.signal.reason) : pluginNetworkError(error);
      }
    };
  }

  const llm = services.llm as Record<string, unknown> | undefined;
  for (const operation of ["ask", "askDetailed"] as const) {
    if (!llm || typeof llm[operation] !== "function") continue;
    llm[operation] = (input: Parameters<NonNullable<PluginContext["services"]["llm"]>["ask"]>[0]) => {
      const { signal, ...payload } = input;
      return call(`services.llm.${operation}`, [payload], signal);
    };
  }

  return ctx as unknown as PluginContext;
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

let plugin: PluginModule | null = null;
let pluginContext: PluginContext | null = null;
let booted = false;
let serviceId: string | undefined;
let serviceInvoked = false;
let stopped = false;
const failProtocol = () => {
  stopped = true;
  pendingCalls.close(codedError("Host protocol failed", "plugin/unavailable"));
  callbacks.clear();
  post({ t: "failed", error: "Host protocol or transport version rejected" });
};
self.onmessageerror = () => {
  if (!stopped) failProtocol();
};

self.onmessage = async (event: MessageEvent<unknown>) => {
  if (stopped) return;
  let message: HostMessage;
  try {
    message = parsePluginHostMessage(event.data);
    if ((!booted && message.t !== "boot") || (booted && message.t === "boot")) {
      throw codedError("Invalid plugin bootstrap sequence", "plugin/invalid-input");
    }
  } catch (error) {
    const raw = event.data as { t?: unknown; id?: unknown; disposable?: unknown } | null;
    if (booted && raw && validPluginCallId(raw.id) && raw.t === "invoke") {
      post({ t: "result", id: raw.id, ok: false, code: codeOf(error), error: "Host message rejected" });
    } else if (booted && raw && validPluginCallId(raw.id) && raw.t === "result") {
      pendingCalls.settle(raw.id, false, error);
      // Rejected results must not strand a registration on the authoritative host.
      if (typeof raw.disposable === "string" && raw.disposable.length > 0 && raw.disposable.length <= 128)
        post({ t: "dispose", handle: raw.disposable });
    } else {
      failProtocol();
    }
    return;
  }

  switch (message.t) {
    case "boot": {
      booted = true;
      post({ t: "hello", protocolVersion: PLUGIN_PROTOCOL_VERSION });
      try {
        storageSnapshot.replace(message.storage);
        appLocale = message.locale;
        lifecyclePhase = message.phase;
        const loaded = (await import(/* @vite-ignore */ message.url)) as {
          default?: typeof plugin;
        };
        plugin = loaded.default ?? null;
        if (!plugin || typeof plugin.activate !== "function") {
          throw new Error("entry module must default-export an object with activate()");
        }
        pluginContext = buildContext(
          message.manifest,
          message.appVersion,
          message.capabilities,
          message.grants,
          message.shape,
        );
        serviceId = message.serviceId;
        if (serviceId !== undefined) {
          if (
            !plugin.services ||
            !Object.hasOwn(plugin.services, serviceId) ||
            typeof plugin.services[serviceId] !== "function"
          )
            throw new Error("Declared service export is missing");
        } else await plugin.activate(pluginContext);
        await drainActivationCalls();
        if (!stopped)
          post({
            t: "ready",
            protocolVersion: PLUGIN_PROTOCOL_VERSION,
            hasMigration: typeof plugin.migrate === "function",
          });
      } catch (error) {
        if (!stopped) post({ t: "failed", error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    case "service": {
      try {
        if (!serviceId || serviceId !== message.serviceId || serviceInvoked || lifecyclePhase !== "active")
          throw codedError("Service invocation is unavailable", "plugin/service-unavailable");
        serviceInvoked = true;
        const value = await plugin!.services![serviceId]!(pluginContext!, message.input);
        if (!stopped)
          callbacks.send(value ?? null, (wire) => post({ t: "result", id: message.id, ok: true, value: wire }));
      } catch (error) {
        if (!stopped)
          post({
            t: "result",
            id: message.id,
            ok: false,
            code: codeOf(error),
            error: error instanceof Error ? error.message : String(error),
          });
      }
      return;
    }

    case "invoke": {
      try {
        const value = await callbacks.invoke(message.handle, message.args);
        if (stopped) return;
        callbacks.send(value ?? null, (wire) => post({ t: "result", id: message.id, ok: true, value: wire }));
      } catch (error) {
        if (stopped) return;
        post({
          t: "result",
          id: message.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          code: codeOf(error),
        });
      }
      return;
    }

    case "sync": {
      if (message.patch.storage) {
        storageSnapshot.replace(message.patch.storage);
      }
      if (message.patch.locale !== undefined) appLocale = message.patch.locale;
      if (message.patch.phase !== undefined) lifecyclePhase = message.patch.phase;
      return;
    }

    case "result": {
      const accepted = pendingCalls.settle(
        message.id,
        message.ok,
        message.ok ? { value: message.value, disposable: message.disposable } : codedError(message.error, message.code),
      );
      if (!accepted && message.ok && message.disposable) post({ t: "dispose", handle: message.disposable });
      return;
    }

    case "release": {
      callbacks.release(message.handles);
      return;
    }

    case "health": {
      post({ t: "healthy", id: message.id });
      return;
    }

    case "quiesce": {
      lifecyclePhase = "activating";
      try {
        await drainActivationCalls();
        if (!stopped) post({ t: "quiesced" });
      } catch (error) {
        if (!stopped) post({ t: "quiesced", error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    case "migrate": {
      try {
        if (lifecyclePhase !== "migrating" || !pluginContext) {
          throw new Error("plugin migration was requested outside the migrating phase");
        }
        if (typeof plugin?.migrate !== "function") {
          throw new Error("plugin data schema changed but the default-exported module has no migrate() method");
        }
        const migrationContext: PluginMigrationContext = {
          manifest: pluginContext.manifest,
          lifecycle: { phase: "migrating" },
          logging: pluginContext.services.logging,
          storage: {
            get: pluginContext.services.storage.get,
            getDurable: pluginContext.services.storage.getDurable,
            set: pluginContext.services.storage.set,
            remove: pluginContext.services.storage.remove,
            flush: pluginContext.services.storage.flush,
            collection: pluginContext.services.storage.collection,
            applyDocuments: pluginContext.services.storage.applyDocuments,
          },
        };
        await plugin.migrate(migrationContext, message.migration);
        await drainActivationCalls();
        if (!stopped) post({ t: "migrated", id: message.id, ok: true });
      } catch (error) {
        if (stopped) return;
        post({
          t: "migrated",
          id: message.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    case "deactivate": {
      stopped = true;
      pendingCalls.close(codedError("Plugin runtime stopped", "plugin/unavailable"));
      try {
        await (serviceId ? undefined : plugin?.deactivate?.());
      } catch (error) {
        // Raw console on purpose: the Worker has no Tauri IPC, so it cannot
        // reach the logger seam — errors reach it via the host's onerror.
        console.error("[plugin-sandbox] deactivate threw", error);
      }
      callbacks.clear();
      // Sent past the stopped gate on purpose: it is the host's signal to terminate.
      post({ t: "deactivated" });
      return;
    }
  }
};
