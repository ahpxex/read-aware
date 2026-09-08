import { AppError } from "@read-aware/core";

type Callback = (...args: unknown[]) => unknown;
export type PluginCallbackWire = {
  data: unknown;
  /** References share identity with placeholders in data after structured clone. */
  callbacks: { ref: object; handle: string }[];
};

// A valid 50,000-row virtual list may carry multiple callbacks per row.
const MAX_CALLBACKS = 100_000;
const MAX_ENTRIES = 1_000_000;
const MAX_DEPTH = 128;
const invalid = () => new AppError("plugin/invalid-input", "Invalid plugin callback payload");
const remoteReleases = new WeakMap<Callback, () => void>();
const remoteRetains = new WeakMap<Callback, () => () => void>();
const remoteOwners = new WeakMap<object, AbortSignal>();

/** Walk containers, preserving cycles, aliases, sparse arrays and inert property names. */
function mapGraph(value: unknown, replace: (value: unknown) => unknown, copy = true): unknown {
  const seen = new Map<object, unknown>();
  let entries = 0;
  const visit = (input: unknown, depth: number): unknown => {
    if (++entries > MAX_ENTRIES) throw invalid();
    const replaced = replace(input);
    if (replaced !== input) return replaced;
    if (typeof input === "symbol" || typeof input === "function") throw invalid();
    if (input === null || typeof input !== "object") return input;
    if (seen.has(input)) return seen.get(input);
    if (depth > MAX_DEPTH) throw invalid();
    if (input instanceof Map) {
      const result = copy ? new Map() : input;
      seen.set(input, result);
      for (const [key, entry] of input) {
        const nextKey = visit(key, depth + 1), next = visit(entry, depth + 1);
        if (copy) result.set(nextKey, next);
      }
      return result;
    }
    if (input instanceof Set) {
      const result = copy ? new Set() : input;
      seen.set(input, result);
      for (const entry of input) { const next = visit(entry, depth + 1); if (copy) result.add(next); }
      return result;
    }
    const prototype = Object.getPrototypeOf(input);
    if (Array.isArray(input) || prototype === Object.prototype || prototype === null) {
      const result = copy ? (Array.isArray(input) ? new Array(input.length) : {}) : input;
      seen.set(input, result);
      for (const [key, entry] of Object.entries(input)) {
        const next = visit(entry, depth + 1);
        if (copy) Object.defineProperty(result, key, { value: next, enumerable: true, writable: true, configurable: true });
      }
      return result;
    }
    // Native structured-clone values (buffers, views, dates, blobs, errors)
    // retain their native transport semantics. postMessage rejects unsupported values.
    return input;
  };
  return visit(value, 0);
}

/** One instance per Worker. Every encoding owns independent callback handles. */
export class PluginCallbackRegistry {
  private nextHandle = 1;
  private readonly handlers = new Map<string, Callback>();

  get size(): number { return this.handlers.size; }

  encode(data: unknown): PluginCallbackWire {
    const staged = new Map<Callback, { ref: object; handle: string }>();
    const encoded = mapGraph(data, value => {
      if (typeof value !== "function") return value;
      const fn = value as Callback;
      let entry = staged.get(fn);
      if (!entry) {
        if (staged.size >= MAX_CALLBACKS) {
          throw new AppError("plugin/busy", "Too many callbacks in one plugin payload");
        }
        entry = { ref: {}, handle: `h${this.nextHandle++}` };
        staged.set(fn, entry);
      }
      return entry.ref;
    });
    for (const [fn, { handle }] of staged) this.handlers.set(handle, fn);
    return { data: encoded, callbacks: [...staged.values()] };
  }

  send(data: unknown, send: (wire: PluginCallbackWire) => void): void {
    const wire = this.encode(data);
    try { send(wire); }
    catch (error) {
      this.release(wire.callbacks.map(entry => entry.handle));
      throw error;
    }
  }

  invoke(handle: string, args: unknown[]): unknown {
    const fn = this.handlers.get(handle);
    if (!fn) throw new AppError("plugin/unavailable", "Plugin callback has been released");
    return fn(...args);
  }

  release(handles: readonly string[]): void {
    for (const handle of handles) this.handlers.delete(handle);
  }

  clear(): void { this.handlers.clear(); }
}

export function decodePluginCallbacks(
  wire: PluginCallbackWire,
  invoke: (handle: string, args: unknown[]) => unknown,
  release?: (handles: string[]) => void,
  owner?: AbortSignal,
): unknown {
  if (!wire || typeof wire !== "object" || !Object.hasOwn(wire, "data")
    || !Array.isArray(wire.callbacks) || wire.callbacks.length > MAX_CALLBACKS) throw invalid();
  const references = new Map<object, Callback>();
  const used = new Set<object>();
  for (const entry of wire.callbacks) {
    if (!entry || !entry.ref || typeof entry.ref !== "object" || references.has(entry.ref)
      || typeof entry.handle !== "string" || !/^h[1-9][0-9]{0,15}$/.test(entry.handle)) throw invalid();
    let released = false;
    let owners = 0;
    const callback: Callback = (...args) => released
      ? Promise.reject(new AppError("plugin/unavailable", "Plugin callback has been released"))
      : invoke(entry.handle, args);
    const discard = () => {
      if (released || owners) return;
      released = true;
      release?.([entry.handle]);
    };
    if (release) {
      remoteReleases.set(callback, discard);
      remoteRetains.set(callback, () => {
        if (released) throw new AppError("plugin/unavailable", "Plugin callback has been released");
        owners++;
        let held = true;
        return () => { if (held) { held = false; owners--; discard(); } };
      });
    }
    references.set(entry.ref, callback);
  }
  const data = mapGraph(wire.data, value => {
    const callback = references.get(value as object);
    if (!callback) return value;
    used.add(value as object);
    return callback;
  });
  if (used.size !== references.size) throw invalid();
  if (owner) mapGraph(data, value => {
    if (value !== null && (typeof value === "object" || typeof value === "function")) remoteOwners.set(value, owner);
    return typeof value === "function" ? null : value;
  }, false);
  return data;
}

/** The Worker owns declarations even when a view contains no callbacks. */
export function observePluginCallbackOwners(value: unknown, onRetired: () => void): () => void {
  const owners = new Set<AbortSignal>();
  mapGraph(value, entry => {
    if (entry !== null && (typeof entry === "object" || typeof entry === "function")) {
      const owner = remoteOwners.get(entry);
      if (owner) owners.add(owner);
    }
    return typeof entry === "function" ? null : entry;
  }, false);
  if ([...owners].some(owner => owner.aborted)) throw new AppError("plugin/unavailable", "Plugin view owner has stopped");
  for (const owner of owners) owner.addEventListener("abort", onRetired, { once: true });
  return () => { for (const owner of owners) owner.removeEventListener("abort", onRetired); };
}

/** Discard an unconsumed result; live view leases keep shared callbacks alive. */
export function releasePluginCallbacks(value: unknown, transferred?: unknown): void {
  const keep = new Set<unknown>();
  if (transferred !== undefined) mapGraph(transferred, entry => {
    if (typeof entry !== "function") return entry;
    keep.add(entry);
    return null;
  }, false);
  const releases = new Set<() => void>();
  mapGraph(value, entry => {
    if (typeof entry !== "function") return entry;
    const release = remoteReleases.get(entry as Callback);
    if (release && !keep.has(entry)) releases.add(release);
    return null;
  }, false);
  const errors: unknown[] = [];
  for (const release of releases) {
    try { release(); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, "Plugin callbacks failed to release");
}

/** Own exactly the callbacks in this graph, including aliases, until disposal. */
export function retainPluginCallbacks(value: unknown): () => void {
  const retains = new Set<() => () => void>();
  mapGraph(value, entry => {
    if (typeof entry !== "function") return entry;
    const retain = remoteRetains.get(entry as Callback);
    if (retain) retains.add(retain);
    return null;
  }, false);
  const releases: (() => void)[] = [];
  const dispose = () => {
    const errors: unknown[] = [];
    for (const release of releases.splice(0)) {
      try { release(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "Plugin callback leases failed to release");
  };
  try { for (const retain of retains) releases.push(retain()); }
  catch (error) { dispose(); throw error; }
  return dispose;
}
