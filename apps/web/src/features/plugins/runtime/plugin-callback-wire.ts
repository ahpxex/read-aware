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

/** Walk containers, preserving cycles, aliases, sparse arrays and inert property names. */
function mapGraph(value: unknown, replace: (value: unknown) => unknown): unknown {
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
      const result = new Map();
      seen.set(input, result);
      for (const [key, entry] of input) result.set(visit(key, depth + 1), visit(entry, depth + 1));
      return result;
    }
    if (input instanceof Set) {
      const result = new Set();
      seen.set(input, result);
      for (const entry of input) result.add(visit(entry, depth + 1));
      return result;
    }
    const prototype = Object.getPrototypeOf(input);
    if (Array.isArray(input) || prototype === Object.prototype || prototype === null) {
      const result = Array.isArray(input) ? new Array(input.length) : {};
      seen.set(input, result);
      for (const [key, entry] of Object.entries(input)) {
        Object.defineProperty(result, key, {
          value: visit(entry, depth + 1), enumerable: true, writable: true, configurable: true,
        });
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

export function decodePluginCallbacks(wire: PluginCallbackWire, invoke: (handle: string, args: unknown[]) => unknown): unknown {
  if (!wire || typeof wire !== "object" || !Object.hasOwn(wire, "data")
    || !Array.isArray(wire.callbacks) || wire.callbacks.length > MAX_CALLBACKS) throw invalid();
  const references = new Map<object, Callback>();
  const used = new Set<object>();
  for (const entry of wire.callbacks) {
    if (!entry || !entry.ref || typeof entry.ref !== "object" || references.has(entry.ref)
      || typeof entry.handle !== "string" || !/^h[1-9][0-9]{0,15}$/.test(entry.handle)) throw invalid();
    references.set(entry.ref, (...args) => invoke(entry.handle, args));
  }
  const data = mapGraph(wire.data, value => {
    const callback = references.get(value as object);
    if (!callback) return value;
    used.add(value as object);
    return callback;
  });
  if (used.size !== references.size) throw invalid();
  return data;
}
