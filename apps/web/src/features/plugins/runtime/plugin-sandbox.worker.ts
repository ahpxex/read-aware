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
 *   - **Synchronous reads.** `storage.get()` and `dictionary.getLanguage()` are
 *     synchronous in the plugin API and stay that way: the host ships a
 *     snapshot before `activate()` and pushes updates after, so the answer is
 *     always local. Plugin source needs no change for this.
 *   - **Callbacks.** A registration carries functions (`run`, `segmentText`),
 *     which cannot be cloned. They stay here; the host gets a serializable
 *     description plus a handle and calls back through `invoke`.
 */
import type {
  PluginContext,
  PluginDisposable,
  PluginManifest,
} from "@read-aware/plugin-types";

// ─── Wire protocol ───────────────────────────────────────────────────────────

type HostMessage =
  | {
      t: "boot";
      url: string;
      manifest: PluginManifest;
      appVersion: string;
      shape: ContextShape;
      storage: Record<string, string>;
      language: string;
    }
  | { t: "invoke"; id: number; handle: string; args: unknown[] }
  | { t: "event"; handle: string; payload: unknown }
  | { t: "sync"; patch: { storage?: Record<string, string>; language?: string } }
  | { t: "result"; id: number; ok: true; value: unknown }
  | { t: "result"; id: number; ok: false; error: string }
  | { t: "deactivate" };

type WorkerMessage =
  | { t: "ready" }
  | { t: "failed"; error: string }
  | { t: "register"; kind: string; handle: string; payload: unknown }
  | { t: "dispose"; handle: string }
  | { t: "call"; id: number; method: string; args: unknown[] }
  | { t: "storage"; op: "set" | "remove"; key: string; value?: string }
  | { t: "language"; value: string }
  | { t: "result"; id: number; ok: true; value: unknown }
  | { t: "result"; id: number; ok: false; error: string };

const post = (message: WorkerMessage) => self.postMessage(message);

// ─── Host calls (plugin → host, async) ───────────────────────────────────────

let nextCallId = 1;
const pendingCalls = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();

function callHost(method: string, args: unknown[]): Promise<unknown> {
  const id = nextCallId++;
  return new Promise((resolve, reject) => {
    pendingCalls.set(id, { resolve, reject });
    post({ t: "call", id, method, args });
  });
}

/** Mirrors the host's `describeContext` output. */
type ContextShape = { [key: string]: "fn" | ContextShape };

/**
 * Build a namespace from the host's description: every leaf becomes a method
 * that round-trips to the permission check on the far side. Nothing is
 * hand-listed here, so the sandbox always exposes exactly what the host granted
 * — including nested namespaces like `books.write`.
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

// ─── Callbacks the host invokes (host → plugin) ──────────────────────────────

let nextHandle = 1;
const handlers = new Map<string, (...args: unknown[]) => unknown>();

/** Park a function here and hand the host an opaque id for it. */
function retain(fn: (...args: unknown[]) => unknown): string {
  const handle = `h${nextHandle++}`;
  handlers.set(handle, fn);
  return handle;
}

/**
 * Register a contribution: functions stay in this realm behind handles, the
 * rest is cloned to the host. `fnKeys` names the properties to retain.
 */
function register(kind: string, value: Record<string, unknown>, fnKeys: string[]): PluginDisposable {
  const handle = `c${nextHandle++}`;
  const payload: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (fnKeys.includes(key) && typeof entry === "function") {
      payload[key] = { __fn: retain(entry as (...args: unknown[]) => unknown) };
    } else if (typeof entry !== "function") {
      payload[key] = entry;
    }
  }
  post({ t: "register", kind, handle, payload });
  return {
    dispose() {
      post({ t: "dispose", handle });
    },
  };
}

/** Subscriptions: the host pushes events at a retained handler. */
function subscribe(method: string, event: string, handler: (payload: unknown) => void): PluginDisposable {
  const handle = retain(handler as (...args: unknown[]) => unknown);
  post({ t: "register", kind: method, handle, payload: { event } });
  return {
    dispose() {
      handlers.delete(handle);
      post({ t: "dispose", handle });
    },
  };
}

// ─── Locally-mirrored state (keeps the sync API sync) ────────────────────────

const storageSnapshot = new Map<string, string>();
let dictionaryLanguage = "";

// ─── Context assembly ────────────────────────────────────────────────────────

function buildContext(
  manifest: PluginManifest,
  appVersion: string,
  shape: ContextShape,
): PluginContext {
  const { __collection: collectionShape = {}, ...namespaces } = shape;

  // Everything the host granted, proxied verbatim.
  const ctx = remoteNamespace("", namespaces as ContextShape) as Record<string, unknown>;

  ctx.manifest = manifest;
  ctx.appVersion = appVersion;

  // Storage: reads answer from the snapshot the host shipped at boot, so the
  // plugin-facing API stays synchronous. Writes update it locally and tell the
  // host, mirroring how `localKV` behaves on the other side.
  ctx.storage = {
    get<T = unknown>(key: string): T | null {
      const raw = storageSnapshot.get(key);
      if (raw === undefined) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    },
    set(key: string, value: unknown): void {
      const raw = JSON.stringify(value ?? null);
      storageSnapshot.set(key, raw);
      post({ t: "storage", op: "set", key, value: raw });
    },
    remove(key: string): void {
      storageSnapshot.delete(key);
      post({ t: "storage", op: "remove", key });
    },
    collection: (name: string) =>
      remoteNamespace(`storage.collection(${name})`, collectionShape as ContextShape),
  };

  ctx.session = {
    on: (event: string, handler: (payload: unknown) => void) =>
      subscribe("session.on", event, handler),
  };

  // Registrations and subscriptions keep their functions in this realm; only a
  // description crosses. Applied over the proxied namespaces above.
  const contributions: Array<[string, string, string[]]> = [
    ["ui.registerSelectionAction", "ui.selectionAction", ["run", "isEnabled"]],
    ["ui.registerHeaderAction", "ui.headerAction", ["run", "isEnabled"]],
    ["ui.registerCommand", "ui.command", ["run"]],
    ["reader.modes.register", "reader.mode", ["segmentText"]],
    ["agent.registerTool", "agent.tool", ["run"]],
  ];
  for (const [path, kind, fnKeys] of contributions) {
    const parts = path.split(".");
    let target = ctx as Record<string, unknown>;
    for (const part of parts.slice(0, -1)) {
      const next = target[part];
      if (!next || typeof next !== "object") {
        target = null as unknown as Record<string, unknown>;
        break;
      }
      target = next as Record<string, unknown>;
    }
    // Absent means the manifest did not earn it — leave it absent.
    if (!target) continue;
    target[parts[parts.length - 1]] = (value: Record<string, unknown>) =>
      register(kind, value, fnKeys);
  }

  // Domain event subscriptions, wherever the host exposed an `on`.
  for (const namespace of ["books", "collections", "annotations", "reading", "conversations"]) {
    const api = ctx[namespace] as Record<string, unknown> | undefined;
    if (api && typeof api.on === "function") {
      api.on = (event: string, handler: (payload: unknown) => void) =>
        subscribe(`${namespace}.on`, event, handler);
    }
  }

  // `showToast` is fire-and-forget in the plugin API; don't hand back a promise.
  const ui = ctx.ui as Record<string, unknown> | undefined;
  if (ui && typeof ui.showToast === "function") {
    const call = ui.showToast as (message: string) => Promise<unknown>;
    ui.showToast = (message: string) => {
      void call(message);
    };
  }
  const reader = ctx.reader as Record<string, unknown> | undefined;
  for (const method of ["openBook", "goTo"]) {
    if (reader && typeof reader[method] === "function") {
      const call = reader[method] as (...args: unknown[]) => Promise<unknown>;
      reader[method] = (...args: unknown[]) => {
        void call(...args);
      };
    }
  }

  // Dictionary language is mirrored locally so `getLanguage()` stays sync.
  const dictionary = ctx.dictionary as Record<string, unknown> | undefined;
  if (dictionary) {
    dictionary.getLanguage = () => dictionaryLanguage;
    dictionary.setLanguage = (language: string) => {
      dictionaryLanguage = language;
      post({ t: "language", value: language });
    };
  }

  // `fetch` must hand back a real Response; the host sends a flattened one.
  const network = ctx.network as Record<string, unknown> | undefined;
  if (network && typeof network.fetch === "function") {
    network.fetch = async (input: unknown, init?: unknown) => {
      const result = (await callHost("network.fetch", [input, init])) as {
        status: number;
        statusText: string;
        headers: Record<string, string>;
        body: string;
      };
      return new Response(result.body, {
        status: result.status,
        statusText: result.statusText,
        headers: result.headers,
      });
    };
  }

  return ctx as unknown as PluginContext;
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

let plugin: { activate?: (ctx: PluginContext) => unknown; deactivate?: () => unknown } | null = null;

self.onmessage = async (event: MessageEvent<HostMessage>) => {
  const message = event.data;

  switch (message.t) {
    case "boot": {
      try {
        for (const [key, value] of Object.entries(message.storage)) {
          storageSnapshot.set(key, value);
        }
        dictionaryLanguage = message.language;
        const loaded = (await import(/* @vite-ignore */ message.url)) as {
          default?: typeof plugin;
        };
        plugin = loaded.default ?? null;
        if (!plugin || typeof plugin.activate !== "function") {
          throw new Error("entry module must default-export an object with activate()");
        }
        await plugin.activate(buildContext(message.manifest, message.appVersion, message.shape));
        post({ t: "ready" });
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
        // Results cross by structured clone; anything non-clonable (a function
        // a plugin tried to smuggle out) fails loudly rather than silently.
        post({ t: "result", id: message.id, ok: true, value: JSON.parse(JSON.stringify(value ?? null)) });
      } catch (error) {
        post({
          t: "result",
          id: message.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    case "event": {
      const handler = handlers.get(message.handle);
      try {
        handler?.(message.payload);
      } catch (error) {
        console.error("[plugin-sandbox] event handler threw", error);
      }
      return;
    }

    case "sync": {
      if (message.patch.storage) {
        storageSnapshot.clear();
        for (const [key, value] of Object.entries(message.patch.storage)) {
          storageSnapshot.set(key, value);
        }
      }
      if (message.patch.language !== undefined) dictionaryLanguage = message.patch.language;
      return;
    }

    case "result": {
      const pending = pendingCalls.get(message.id);
      if (!pending) return;
      pendingCalls.delete(message.id);
      if (message.ok) pending.resolve(message.value);
      else pending.reject(new Error(message.error));
      return;
    }

    case "deactivate": {
      try {
        await plugin?.deactivate?.();
      } catch (error) {
        console.error("[plugin-sandbox] deactivate threw", error);
      }
      handlers.clear();
      return;
    }
  }
};
