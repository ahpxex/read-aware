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
  | { t: "register"; kind: string; handle: string; payload: Record<string, unknown> }
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
  /** Contribution handle → the disposable the host registered for it. */
  const registrations = new Map<string, PluginDisposable>();

  /** Call a function the plugin kept inside the Worker. */
  const invokeHandle = (handle: string, args: unknown[]): Promise<unknown> => {
    const id = nextInvokeId++;
    return new Promise((resolve, reject) => {
      pendingInvokes.set(id, { resolve, reject });
      worker.postMessage({ t: "invoke", id, handle, args });
    });
  };

  /** Rebuild a registration payload, turning handles back into functions. */
  const rehydrate = (payload: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      out[key] = isFnRef(value)
        ? (...args: unknown[]) => invokeHandle(value.__fn, args)
        : value;
    }
    return out;
  };

  const register = (kind: string, handle: string, payload: Record<string, unknown>) => {
    const value = rehydrate(payload);
    let disposable: PluginDisposable | undefined;
    switch (kind) {
      case "ui.selectionAction":
        disposable = ctx.ui.registerSelectionAction(value as never);
        break;
      case "ui.headerAction":
        disposable = ctx.ui.registerHeaderAction(value as never);
        break;
      case "ui.command":
        disposable = ctx.ui.registerCommand(value as never);
        break;
      case "reader.mode":
        disposable = ctx.reader.modes?.register(value as never);
        break;
      case "agent.tool":
        disposable = ctx.agent?.registerTool(value as never);
        break;
      default: {
        // Subscriptions: "<namespace>.on" with the event name in the payload.
        // The handle IS the callback, so events post straight back to it.
        const namespace = kind.replace(/\.on$/, "");
        const api =
          namespace === "session"
            ? ctx.session
            : ((ctx as unknown as Record<string, unknown>)[namespace] as
                | { on?: (event: string, handler: (p: unknown) => void) => PluginDisposable }
                | undefined);
        const event = String(value.event ?? "");
        disposable = api?.on?.(event as never, (payload: unknown) => {
          worker.postMessage({ t: "event", handle, payload });
        });
        break;
      }
    }
    if (disposable) {
      registrations.set(handle, disposable);
      disposables.push(disposable);
    }
  };

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

        case "register":
          register(message.kind, message.handle, message.payload);
          return;

        case "dispose": {
          const disposable = registrations.get(message.handle);
          registrations.delete(message.handle);
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
            let value = await method(...message.args);
            if (value instanceof Response) value = await flattenResponse(value);
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
          if (message.ok) pending.resolve(message.value);
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
