import { AppError } from "@read-aware/core";
import { pluginCallbackOwner } from "../runtime/plugin-callback-wire";

type Lease = { url: string; release(): void };
type Entry = { id: string; refs: number; abort: AbortController; ready: Promise<string>; url?: string; bytes: number };
type UrlPort = { createObjectURL(blob: Blob): string; revokeObjectURL(url: string): void };
const unavailable = () => new AppError("plugin/unavailable", "Plugin image owner is unavailable");

/** Render leases share only one activation's decoded previews. No URL crosses
 * the Worker bridge; the final unmounted consumer releases the copy. */
export class PluginImageOwner {
  private entries = new Map<string, Entry>();
  private bytes = 0;
  private disposed = false;
  constructor(private load: (id: string, signal: AbortSignal) => Promise<Blob>, private urls: UrlPort = URL) {}

  acquire(id: string, signal: AbortSignal): Promise<Lease> {
    if (this.disposed) return Promise.reject(unavailable());
    if (signal.aborted) return Promise.reject(signal.reason);
    let entry = this.entries.get(id);
    if (!entry) {
      if (this.entries.size >= 16) return Promise.reject(new AppError("ui/unavailable", "Too many displayed image resources"));
      const next: Entry = { id, refs: 0, abort: new AbortController(), ready: Promise.resolve(""), bytes: 0 };
      next.ready = Promise.resolve().then(async () => {
        next.abort.signal.throwIfAborted();
        const blob = await this.load(id, next.abort.signal);
        next.abort.signal.throwIfAborted();
        if (blob.type !== "image/png" || !blob.size || blob.size > 20 * 1024 * 1024) throw new AppError("ui/invalid-target", "Invalid image preview");
        if (this.bytes + blob.size > 64 * 1024 * 1024) throw new AppError("ui/unavailable", "Displayed image payload limit exceeded");
        const url = this.urls.createObjectURL(blob);
        next.url = url; next.bytes = blob.size; this.bytes += blob.size;
        return url;
      });
      entry = next; this.entries.set(id, next);
    }
    const current = entry; current.refs++;
    return new Promise((resolve, reject) => {
      let released = false;
      const release = () => {
        if (released) return;
        released = true; signal.removeEventListener("abort", abort);
        current.abort.signal.removeEventListener("abort", retired);
        if (--current.refs === 0) this.remove(current);
      };
      const abort = () => { release(); reject(signal.reason); };
      const retired = () => { release(); reject(current.abort.signal.reason); };
      signal.addEventListener("abort", abort, { once: true });
      current.abort.signal.addEventListener("abort", retired, { once: true });
      current.ready.then(url => {
        if (!released && !this.disposed) resolve({ url, release });
        else { release(); reject(unavailable()); }
      }, error => { release(); reject(error); });
    });
  }
  dispose = () => {
    this.disposed = true;
    for (const entry of this.entries.values()) this.remove(entry);
  };
  private remove(entry: Entry) {
    if (this.entries.get(entry.id) === entry) this.entries.delete(entry.id);
    entry.abort.abort(unavailable());
    if (entry.url) {
      this.urls.revokeObjectURL(entry.url); entry.url = undefined;
      this.bytes -= entry.bytes; entry.bytes = 0;
    }
  }
}

const owners = new WeakMap<AbortSignal, PluginImageOwner>();
const bindings = new WeakMap<object, PluginImageOwner>();

export function registerPluginImageOwner(signal: AbortSignal, load: (id: string, signal: AbortSignal) => Promise<Blob>, urls?: UrlPort): () => void {
  if (signal.aborted || owners.has(signal)) throw unavailable();
  const owner = new PluginImageOwner(load, urls);
  owners.set(signal, owner);
  const dispose = () => { signal.removeEventListener("abort", dispose); owners.delete(signal); owner.dispose(); };
  signal.addEventListener("abort", dispose, { once: true });
  return dispose;
}

/** Only the bridge's unforgeable activation identity may bind a resource owner. */
export function bindPluginImageOwner(raw: object, normalized: object): void {
  const owner = pluginImageOwner(raw);
  if (owner) bindings.set(normalized, owner);
}
export function pluginImageOwner(value: object): PluginImageOwner | undefined {
  const signal = pluginCallbackOwner(value);
  return bindings.get(value) ?? (signal ? owners.get(signal) : undefined);
}
