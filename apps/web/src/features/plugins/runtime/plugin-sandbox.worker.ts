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
 * The ONLY way out is `postMessage` to the host, which checks the manifest
 * before it touches anything (see plugin-worker-host.ts). That check is now the
 * real boundary, because there is nothing else to reach.
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
import type {
  PluginContext,
  PluginManifest,
  PluginMigration,
  PluginMigrationContext,
  PluginModule,
} from "@read-aware/plugin-types";
import { PluginStorageMirror } from "./plugin-storage-mirror";
import { flattenPluginRequest, restorePluginResponse, type PluginNetworkResponse } from "./plugin-network-wire";
import { PluginRpcPending } from "./plugin-rpc-pending";

// ─── Wire protocol ───────────────────────────────────────────────────────────

type HostMessage =
  | {
      t: "boot";
      url: string;
      manifest: PluginManifest;
      appVersion: string;
      capabilities: PluginContext["capabilities"];
      shape: ContextShape;
      storage: Record<string, string>;
      locale: string;
      phase: PluginContext["lifecycle"]["phase"];
    }
  | { t: "invoke"; id: number; handle: string; args: unknown[] }
  | {
      t: "sync";
      patch: {
        storage?: Record<string, string>;
        locale?: string;
        phase?: PluginContext["lifecycle"]["phase"];
      };
    }
  | { t: "result"; id: number; ok: true; value: unknown }
  | { t: "result"; id: number; ok: false; error: string; code?: string }
  | { t: "health"; id: number }
  | { t: "migrate"; id: number; migration: PluginMigration }
  | { t: "quiesce" }
  | { t: "deactivate" };

type WorkerMessage =
  | { t: "ready"; hasMigration: boolean }
  | { t: "failed"; error: string }
  | { t: "dispose"; handle: string }
  | { t: "call"; id: number; method: string; args: unknown[] }
  | { t: "cancel"; id: number }
  | { t: "result"; id: number; ok: true; value: unknown }
  | { t: "result"; id: number; ok: false; error: string; code?: string }
  | { t: "healthy"; id: number }
  | { t: "migrated"; id: number; ok: true }
  | { t: "migrated"; id: number; ok: false; error: string }
  | { t: "quiesced"; error?: string };

const post = (message: WorkerMessage) => self.postMessage(message);

/**
 * Stable error codes (see @read-aware/core errors.ts) survive the boundary as
 * a plain `code` field: Error instances lose custom properties to structured
 * clone, so both failure directions carry the code explicitly and rebuild it.
 */
const codeOf = (error: unknown): string | undefined => {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string" && code.length > 0) return code;
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
    // A missing/non-configurable API is already unavailable to plugin code.
  }
}

for (const name of [
  "fetch",
  "WebSocket",
  "EventSource",
  "XMLHttpRequest",
  "BroadcastChannel",
  "indexedDB",
  "caches",
]) {
  denyAmbientAuthority(name);
}

// ─── Host calls (plugin → host, async) ───────────────────────────────────────

const pendingCalls = new PluginRpcPending();
const inFlightHostCalls = new Set<Promise<unknown>>();
const lifecycleCallErrors: unknown[] = [];

/** Mirrors the host's `describeContext` output. */
type ContextShape = { [key: string]: "fn" | ContextShape };

// ─── Crossing the boundary with functions in tow ─────────────────────────────

let nextHandle = 1;
const handlers = new Map<string, (...args: unknown[]) => unknown>();

/** Park a function here and hand the host an opaque id for it. */
function retain(fn: (...args: unknown[]) => unknown): string {
  const handle = `h${nextHandle++}`;
  handlers.set(handle, fn);
  return handle;
}

/**
 * Replace every function in an argument with a handle, recursively.
 *
 * This is why the boundary needs no list of which methods take callbacks. The
 * previous design carried one — per contribution kind, naming the callable
 * properties — and it was a second copy of the contracts that had already
 * drifted: a tool's callable is `execute`, a header action's is `view`, and both
 * were silently dropped. Encoding by SHAPE instead of by name cannot drift.
 */
function encode(value: unknown): unknown {
  if (typeof value === "function") {
    return { __fn: retain(value as (...args: unknown[]) => unknown) };
  }
  if (Array.isArray(value)) return value.map(encode);
  // Plain objects only: a Request/URL/Date must cross as itself.
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, encode(entry)]));
  }
  return value;
}

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
type CallResult = Promise<unknown> & { dispose: () => void };

function callHost(method: string, args: unknown[], signal?: AbortSignal): CallResult {
  const promise = pendingCalls.call(id => {
    post({ t: "call", id, method, args: encode(args) as unknown[] });
  }, { signal, cancel: id => post({ t: "cancel", id }) });
  inFlightHostCalls.add(promise);
  void promise.then(
    () => inFlightHostCalls.delete(promise),
    (error) => {
      inFlightHostCalls.delete(promise);
      if (lifecyclePhase !== "active" && codeOf(error) !== "plugin/cancelled") lifecycleCallErrors.push(error);
    },
  );
  const result = promise as CallResult;
  result.dispose = () => {
    void promise
      .then((value) => {
        const handle = (value as { __disposable?: string } | null)?.__disposable;
        if (handle) post({ t: "dispose", handle });
      })
      .catch(() => {
        // Nothing was registered, so there is nothing to release.
      });
  };
  return result;
}

/**
 * Build a namespace from the host's description: every leaf becomes a method
 * that round-trips to the permission check on the far side. Nothing is
 * hand-listed, so the sandbox always exposes exactly what the host granted —
 * including nested namespaces like `books.write`.
 */
function remoteNamespace(path: string, shape: ContextShape): Record<string, unknown> {
  const api: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(shape)) {
    const method = path ? `${path}.${key}` : key;
    api[key] =
      entry === "fn"
        ? (...args: unknown[]) => callHost(method, args)
        : remoteNamespace(method, entry);
  }
  return api;
}

// ─── Locally-mirrored state (keeps the sync API sync) ────────────────────────

const storageSnapshot = new PluginStorageMirror();
let appLocale = "";
let lifecyclePhase: PluginContext["lifecycle"]["phase"] = "activating";

function assertLocalStorageWrite(): void {
  if (lifecyclePhase !== "active" && lifecyclePhase !== "migrating") {
    throw new Error(`plugin storage writes are unavailable while plugin is ${lifecyclePhase}`);
  }
}

async function drainActivationCalls(): Promise<void> {
  while (inFlightHostCalls.size > 0) {
    const results = await Promise.allSettled([...inFlightHostCalls]);
    const failed = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
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
  shape: ContextShape,
): PluginContext {
  const { __collection: collectionShape = {}, ...namespaces } = shape;

  // Everything the host granted, proxied verbatim.
  const ctx = remoteNamespace("", namespaces as ContextShape) as Record<string, unknown>;

  ctx.manifest = manifest;
  ctx.appVersion = appVersion;
  ctx.capabilities = capabilities;
  // Mirrored locally (boot + sync patches) so the read stays synchronous.
  Object.defineProperty(ctx, "locale", { get: () => appLocale, enumerable: true });
  ctx.lifecycle = {};
  Object.defineProperty(ctx.lifecycle, "phase", {
    get: () => lifecyclePhase,
    enumerable: true,
  });

  // Storage: reads answer from the snapshot the host shipped at boot, so the
  // plugin-facing API stays synchronous. Writes update it locally and tell the
  // host, mirroring how `localKV` behaves on the other side.
  const services = ctx.services as Record<string, unknown>;
  services.storage = {
    get<T = unknown>(key: string): T | null {
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
      const call = callHost("services.storage.set", [key, value]);
      void call.then(() => storageSnapshot.settle(id), () => storageSnapshot.settle(id));
      return call as Promise<void>;
    },
    remove(key: string): Promise<void> {
      assertLocalStorageWrite();
      const id = storageSnapshot.begin(key, null);
      const call = callHost("services.storage.remove", [key]);
      void call.then(() => storageSnapshot.settle(id), () => storageSnapshot.settle(id));
      return call as Promise<void>;
    },
    flush: () => callHost("services.storage.flush", []),
    // Host-side writes (settings page, agent) arrive as a `sync` patch and
    // then as this notification — in that order, so the mirror the handler
    // reads from is already fresh. The plugin's own writes do not echo.
    onChange: (handler: () => void) =>
      callHost("services.storage.onChange", [handler]),
    collection: (name: string) =>
      remoteNamespace(
        `services.storage.collection(${name})`,
        collectionShape as ContextShape,
      ),
  };

  // `showToast` is fire-and-forget in the plugin API; don't hand back a promise.
  const ui = services.ui as Record<string, unknown> | undefined;
  if (ui && typeof ui.showToast === "function") {
    const call = ui.showToast as (message: string) => Promise<unknown>;
    ui.showToast = (message: string) => {
      void call(message);
    };
  }
  const reading = (ctx.domains as Record<string, unknown> | undefined)?.reading as
    | Record<string, unknown>
    | undefined;
  const reader = reading?.commands as Record<string, unknown> | undefined;
  for (const method of ["openBook", "goTo"]) {
    if (reader && typeof reader[method] === "function") {
      const call = reader[method] as (...args: unknown[]) => Promise<unknown>;
      reader[method] = (...args: unknown[]) => {
        void call(...args);
      };
    }
  }

  // `fetch` needs translation on BOTH sides of the crossing. The request may
  // carry platform objects postMessage cannot clone — a URL or Request as
  // input, a Headers instance, an AbortSignal — so it is flattened to plain
  // data here; the response comes back flattened (body as ArrayBuffer, so
  // binary payloads survive) and is rebuilt into a real Response.
  const network = services.network as Record<string, unknown> | undefined;
  if (network && typeof network.fetch === "function") {
    network.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = await flattenPluginRequest(input, init);
      const result = await callHost("services.network.fetch", [request.url, request.init], request.signal);
      return restorePluginResponse(result as PluginNetworkResponse);
    };
  }

  return ctx as unknown as PluginContext;
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

let plugin: PluginModule | null = null;
let pluginContext: PluginContext | null = null;

self.onmessage = async (event: MessageEvent<HostMessage>) => {
  const message = event.data;

  switch (message.t) {
    case "boot": {
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
            message.shape,
          );
        await plugin.activate(pluginContext);
        await drainActivationCalls();
        post({ t: "ready", hasMigration: typeof plugin.migrate === "function" });
      } catch (error) {
        post({ t: "failed", error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    case "invoke": {
      const handler = handlers.get(message.handle);
      if (!handler) {
        post({ t: "result", id: message.id, ok: false, error: `stale handle ${message.handle}` });
        return;
      }
      try {
        const value = await handler(...message.args);
        // Encode the RESULT too, not just call arguments. A contribution's
        // return value carries functions of its own — a tool's `execute`
        // answers with a view whose controls have `onChange` — and they have to
        // reach the host as handles it can call back.
        //
        // This used to be a JSON round-trip, which dropped every one of those
        // silently: the plugin's view arrived without its callbacks and the
        // host rejected it as invalid. Structured clone now carries what
        // `encode` produces, and anything genuinely non-clonable throws from
        // `post` into the catch below — visibly, as an error the plugin's
        // author can act on.
        post({ t: "result", id: message.id, ok: true, value: encode(value ?? null) });
      } catch (error) {
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
      pendingCalls.settle(message.id, message.ok, message.ok ? message.value : codedError(message.error, message.code));
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
        post({ t: "quiesced" });
      } catch (error) {
        post({ t: "quiesced", error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    case "migrate": {
      try {
        if (lifecyclePhase !== "migrating" || !pluginContext) {
          throw new Error("plugin migration was requested outside the migrating phase");
        }
        if (typeof plugin?.migrate !== "function") {
          throw new Error("plugin data schema changed but the plugin does not export migrate()");
        }
        const migrationContext: PluginMigrationContext = {
          manifest: pluginContext.manifest,
          lifecycle: { phase: "migrating" },
          storage: {
            get: pluginContext.services.storage.get,
            set: pluginContext.services.storage.set,
            remove: pluginContext.services.storage.remove,
            flush: pluginContext.services.storage.flush,
            collection: pluginContext.services.storage.collection,
          },
        };
        await plugin.migrate(migrationContext, message.migration);
        await drainActivationCalls();
        post({ t: "migrated", id: message.id, ok: true });
      } catch (error) {
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
      pendingCalls.close(codedError("Plugin runtime stopped", "plugin/unavailable"));
      try {
        await plugin?.deactivate?.();
      } catch (error) {
        // Raw console on purpose: the Worker has no Tauri IPC, so it cannot
        // reach the logger seam — errors reach it via the host's onerror.
        console.error("[plugin-sandbox] deactivate threw", error);
      }
      handlers.clear();
      return;
    }
  }
};
