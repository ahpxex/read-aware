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
import type { PluginContext, PluginManifest } from "@read-aware/plugin-types";

// ─── Wire protocol ───────────────────────────────────────────────────────────

type HostMessage =
  | {
      t: "boot";
      url: string;
      manifest: PluginManifest;
      appVersion: string;
      shape: ContextShape;
      storage: Record<string, string>;
      locale: string;
    }
  | { t: "invoke"; id: number; handle: string; args: unknown[] }
  | { t: "sync"; patch: { storage?: Record<string, string>; locale?: string } }
  | { t: "result"; id: number; ok: true; value: unknown }
  | { t: "result"; id: number; ok: false; error: string }
  | { t: "deactivate" };

type WorkerMessage =
  | { t: "ready" }
  | { t: "failed"; error: string }
  | { t: "dispose"; handle: string }
  | { t: "call"; id: number; method: string; args: unknown[] }
  | { t: "storage"; op: "set" | "remove"; key: string; value?: string }
  | { t: "result"; id: number; ok: true; value: unknown }
  | { t: "result"; id: number; ok: false; error: string };

const post = (message: WorkerMessage) => self.postMessage(message);

// ─── Host calls (plugin → host, async) ───────────────────────────────────────

let nextCallId = 1;
const pendingCalls = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (error: Error) => void }
>();

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
 * `ctx.ui.registerCommand(...).dispose()` works on the object it got back, with
 * the release travelling once the host answers.
 */
type CallResult = Promise<unknown> & { dispose: () => void };

function callHost(method: string, args: unknown[]): CallResult {
  const id = nextCallId++;
  const promise = new Promise<unknown>((resolve, reject) => {
    pendingCalls.set(id, { resolve, reject });
    post({ t: "call", id, method, args: encode(args) as unknown[] });
  });
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

const storageSnapshot = new Map<string, string>();
let appLocale = "";

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
  // Mirrored locally (boot + sync patches) so the read stays synchronous.
  Object.defineProperty(ctx, "locale", { get: () => appLocale, enumerable: true });

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

  // `session` is skipped by the shape (its events are ambient, not a granted
  // namespace), so it is proxied here — the handler crosses as an argument like
  // any other function.
  ctx.session = {
    on: (event: string, handler: (payload: unknown) => void) =>
      callHost("session.on", [event, handler]),
  };

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

  // `fetch` needs translation on BOTH sides of the crossing. The request may
  // carry platform objects postMessage cannot clone — a URL or Request as
  // input, a Headers instance, an AbortSignal — so it is flattened to plain
  // data here; the response comes back flattened (body as ArrayBuffer, so
  // binary payloads survive) and is rebuilt into a real Response.
  const network = ctx.network as Record<string, unknown> | undefined;
  if (network && typeof network.fetch === "function") {
    // Statuses the Response constructor refuses to pair with a body.
    const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);
    network.fetch = async (input: unknown, init?: unknown) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input instanceof Request
              ? input.url
              : String(input);
      const { signal, headers, ...rest } =
        (init && typeof init === "object" ? init : {}) as RequestInit;
      const plainInit: Record<string, unknown> = { ...rest };
      // Headers in any accepted form become one plain record.
      if (headers) {
        plainInit.headers = Object.fromEntries(new Headers(headers).entries());
      }

      const call = (async () => {
        const result = (await callHost("network.fetch", [url, plainInit])) as {
          status: number;
          statusText: string;
          url: string;
          headers: Record<string, string>;
          body: ArrayBuffer;
        };
        const response = new Response(
          NULL_BODY_STATUSES.has(result.status) ? null : result.body,
          {
            status: result.status,
            statusText: result.statusText,
            headers: result.headers,
          },
        );
        // The constructor cannot set `url`; shadow the prototype getter so
        // redirect-following plugins still learn the final address.
        Object.defineProperty(response, "url", { value: result.url });
        return response;
      })();

      // An AbortSignal cannot cross the realm; honor it HERE instead — the
      // plugin's await rejects on abort/timeout as fetch semantics promise,
      // while the host-side request simply runs to completion unobserved.
      if (!(signal instanceof AbortSignal)) return call;
      if (signal.aborted) {
        throw signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
      }
      return new Promise<Response>((resolve, reject) => {
        const onAbort = () =>
          reject(
            signal.reason ?? new DOMException("The operation was aborted.", "AbortError"),
          );
        signal.addEventListener("abort", onAbort, { once: true });
        call
          .then(resolve, reject)
          .finally(() => signal.removeEventListener("abort", onAbort));
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
        appLocale = message.locale;
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
        });
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
      if (message.patch.locale !== undefined) appLocale = message.patch.locale;
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
        // Raw console on purpose: the Worker has no Tauri IPC, so it cannot
        // reach the logger seam — errors reach it via the host's onerror.
        console.error("[plugin-sandbox] deactivate threw", error);
      }
      handlers.clear();
      return;
    }
  }
};
