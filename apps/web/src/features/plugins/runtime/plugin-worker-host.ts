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
  PluginManifest,
} from "@read-aware/plugin-types";
import { buildPluginContext, pluginStoragePrefix } from "./plugin-context";
import { pluginModuleUrl } from "./plugin-backend";
import { localKV } from "../../../platform/local-store";
import { getDictionaryLanguage } from "../../reader/lib/dictionary-prefs";

type WorkerMessage =
  | { t: "ready" }
  | { t: "failed"; error: string }
  | { t: "dispose"; handle: string }
  | { t: "call"; id: number; method: string; args: unknown[] }
  | { t: "storage"; op: "set" | "remove"; key: string; value?: string }
  | { t: "language"; value: string }
  | { t: "result"; id: number; ok: true; value: unknown }
  | { t: "result"; id: number; ok: false; error: string };

/** A `{ __fn: handle }` marker the Worker put where a function used to be. */
type FnRef = { __fn: string };
const isFnRef = (value: unknown): value is FnRef =>
  typeof value === "object" && value !== null && typeof (value as FnRef).__fn === "string";

export type SandboxedPlugin = {
  manifest: PluginManifest;
  terminate(): Promise<void>;
};

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
  const collection = method.match(/^storage\.collection\(([^)]*)\)\.(\w+)$/);
  if (collection) {
    const api = ctx.storage.collection(collection[1]) as unknown as Record<string, unknown>;
    const fn = api?.[collection[2]];
    return typeof fn === "function" ? (fn as (...a: unknown[]) => unknown).bind(api) : null;
  }
  const parts = method.split(".");
  let target: unknown = ctx;
  for (let i = 0; i < parts.length - 1; i += 1) {
    target = (target as Record<string, unknown>)?.[parts[i]];
    if (!target) return null;
  }
  const fn = (target as Record<string, unknown>)?.[parts[parts.length - 1]];
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
type ContextShape = { [key: string]: "fn" | ContextShape };

/** Data (not callables) the Worker mirrors locally to keep sync reads sync. */
const SHAPE_SKIP = new Set(["manifest", "appVersion", "storage", "session"]);

function describeShape(value: unknown, depth = 0): ContextShape {
  const shape: ContextShape = {};
  if (!value || typeof value !== "object" || depth > 3) return shape;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "function") shape[key] = "fn";
    else if (entry && typeof entry === "object") shape[key] = describeShape(entry, depth + 1);
  }
  return shape;
}

function describeContext(ctx: PluginContext): ContextShape {
  const shape: ContextShape = {};
  for (const [key, value] of Object.entries(ctx as unknown as Record<string, unknown>)) {
    if (SHAPE_SKIP.has(key)) continue;
    if (typeof value === "function") shape[key] = "fn";
    else if (value && typeof value === "object") shape[key] = describeShape(value, 1);
  }
  // `storage.collection()` is a factory, so its methods are described from a
  // throwaway instance rather than discovered on the context itself.
  try {
    shape.__collection = describeShape(ctx.storage.collection("probe"), 1);
  } catch {
    shape.__collection = {};
  }
  return shape;
}

/** `fetch` returns a Response, which cannot be cloned — flatten it. */
async function flattenResponse(response: Response): Promise<unknown> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers,
    body: await response.text(),
  };
}

export function startPluginWorker(
  manifest: PluginManifest,
  appVersion: string,
  disposables: PluginDisposable[],
): Promise<SandboxedPlugin> {
  const worker = new Worker(new URL("./plugin-sandbox.worker.ts", import.meta.url), {
    type: "module",
    name: `plugin:${manifest.id}`,
  });
  const ctx = buildPluginContext(manifest, appVersion, disposables);

  let nextInvokeId = 1;
  const pendingInvokes = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  /** Call a function the plugin kept inside the Worker. */
  const invokeHandle = (handle: string, args: unknown[]): Promise<unknown> => {
    const id = nextInvokeId++;
    return new Promise((resolve, reject) => {
      pendingInvokes.set(id, { resolve, reject });
      worker.postMessage({ t: "invoke", id, handle, args });
    });
  };

  /**
   * Turn every `{ __fn }` marker in a call's arguments back into a function,
   * recursively.
   *
   * This is the whole of the callback plumbing. There used to be a table of
   * contribution kinds here, mirrored by another in the Worker, naming which
   * properties of which registrations were callable — two hand-written copies of
   * the contracts that had to agree with them and with each other. They did not:
   * a tool's `execute` and a header action's `view` were both missing, so the
   * agent received tools it could not invoke. Decoding by shape needs no list.
   */
  const decode = (value: unknown): unknown => {
    if (isFnRef(value)) {
      const handle = value.__fn;
      return (...args: unknown[]) => invokeHandle(handle, args);
    }
    if (Array.isArray(value)) return value.map(decode);
    if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, decode(entry)]),
      );
    }
    return value;
  };

  /**
   * Disposables the plugin is holding. A `PluginDisposable` cannot be cloned, so
   * the Worker gets a handle and releases it by sending that back.
   */
  const heldDisposables = new Map<string, PluginDisposable>();
  let nextDisposableId = 1;

  return new Promise<SandboxedPlugin>((resolve, reject) => {
    let settled = false;

    worker.onerror = (event) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      reject(new Error(event.message || "plugin worker failed to start"));
    };

    worker.onmessage = async (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      switch (message.t) {
        case "ready":
          if (!settled) {
            settled = true;
            resolve({
              manifest,
              async terminate() {
                worker.postMessage({ t: "deactivate" });
                // Give deactivate() a moment to run its own cleanup, then take
                // the realm down regardless — a plugin must not be able to
                // outlive its uninstall by stalling here.
                await new Promise((done) => setTimeout(done, 50));
                worker.terminate();
              },
            });
          }
          return;

        case "failed":
          if (!settled) {
            settled = true;
            worker.terminate();
            reject(new Error(message.error));
          }
          return;

        case "dispose": {
          const disposable = heldDisposables.get(message.handle);
          heldDisposables.delete(message.handle);
          try {
            disposable?.dispose();
          } catch (error) {
            console.error(`[plugins] dispose from "${manifest.id}" failed`, error);
          }
          return;
        }

        case "storage":
          if (message.op === "set" && message.value !== undefined) {
            ctx.storage.set(message.key, JSON.parse(message.value));
          } else if (message.op === "remove") {
            ctx.storage.remove(message.key);
          }
          return;

        case "language":
          ctx.dictionary?.setLanguage(message.value as never);
          return;

        case "call": {
          const method = resolveMethod(ctx, message.method);
          if (!method) {
            worker.postMessage({
              t: "result",
              id: message.id,
              ok: false,
              error: `"${message.method}" is not available to plugin "${manifest.id}" (check its manifest permissions)`,
            });
            return;
          }
          try {
            let value = await method(...(message.args.map(decode) as unknown[]));
            if (value instanceof Response) value = await flattenResponse(value);
            // A registration answers with a disposable, which cannot be cloned:
            // hold it and send back the handle the Worker releases it by.
            if (
              value &&
              typeof value === "object" &&
              typeof (value as PluginDisposable).dispose === "function"
            ) {
              const handle = `d${nextDisposableId++}`;
              heldDisposables.set(handle, value as PluginDisposable);
              disposables.push(value as PluginDisposable);
              worker.postMessage({
                t: "result",
                id: message.id,
                ok: true,
                value: { __disposable: handle },
              });
              return;
            }
            worker.postMessage({ t: "result", id: message.id, ok: true, value: value ?? null });
          } catch (error) {
            worker.postMessage({
              t: "result",
              id: message.id,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          return;
        }

        case "result": {
          const pending = pendingInvokes.get(message.id);
          if (!pending) return;
          pendingInvokes.delete(message.id);
          // Decode the result, not only call arguments: what a contribution
          // returns carries functions of its own (a view's control `onChange`),
          // and they arrive as handles that have to become callable here.
          if (message.ok) pending.resolve(decode(message.value));
          else pending.reject(new Error(message.error));
          return;
        }
      }
    };

    worker.postMessage({
      t: "boot",
      url: pluginModuleUrl(manifest.id, manifest.main ?? "main.js"),
      manifest,
      appVersion,
      shape: describeContext(ctx),
      storage: localKV.entries(pluginStoragePrefix(manifest.id)),
      language: getDictionaryLanguage(),
    });
  });
}
