import { AppError } from "@read-aware/core";
import type { PluginNetworkChunk, PluginNetworkStream } from "@read-aware/plugin-types";
import { MAX_PLUGIN_NETWORK_BODY_BYTES } from "./plugin-network-wire";

export const PLUGIN_NETWORK_LIMITS: Readonly<{
  timeoutMs: number;
  maxStreamBytes: number;
  maxChunkBytes: number;
  maxConcurrentRequests: number;
  maxHostConcurrentRequests: number;
}> = Object.freeze({
  timeoutMs: 120_000,
  maxStreamBytes: 1024 * 1024 * 1024,
  maxChunkBytes: 1024 * 1024,
  maxConcurrentRequests: 8,
  maxHostConcurrentRequests: 32,
});
let hostRequests = 0;

type Entry = {
  id: string;
  controller: AbortController;
  opening: Promise<Response>;
  reader?: ReadableStreamDefaultReader<Uint8Array>;
  read?: Promise<PluginNetworkChunk>;
  cleanup?: Promise<void>;
  error?: unknown;
  closed: boolean;
  detach: () => void;
  timer: ReturnType<typeof setTimeout>;
  expiresAt: number;
  offset: number;
  received: number;
  limit: number;
  buffered: Uint8Array;
};

/** One activation owns requests from dispatch through native body disposal. */
export class PluginNetworkRequests {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly request: (input: RequestInfo | URL, init: RequestInit) => Promise<Response>,
    private readonly signal: AbortSignal,
    private readonly trackCleanup: (pending: Promise<void>) => void,
    private readonly limits = PLUGIN_NETWORK_LIMITS,
  ) {
    signal.addEventListener("abort", () => {
      for (const entry of this.entries.values()) this.retire(entry, signal.reason);
    }, { once: true });
  }

  async open(input: RequestInfo | URL, init?: RequestInit, limit = this.limits.maxStreamBytes): Promise<PluginNetworkStream> {
    this.signal.throwIfAborted();
    const initial = new Request(input, init);
    initial.signal.throwIfAborted();
    if (this.entries.size >= this.limits.maxConcurrentRequests || hostRequests >= this.limits.maxHostConcurrentRequests) {
      throw new AppError("plugin/network-busy", "Concurrent network request limit reached", { retryable: true });
    }
    const controller = new AbortController();
    const expiresAt = Date.now() + this.limits.timeoutMs;
    const entry: Entry = {
      id: crypto.randomUUID(), controller,
      opening: Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return this.request(initial, { signal: controller.signal });
      }),
      timer: setTimeout(() => this.retire(entry, new AppError("plugin/network-timeout", "Network response lifetime expired")), this.limits.timeoutMs),
      expiresAt, closed: false, offset: 0, received: 0, limit, buffered: new Uint8Array(0), detach: () => {},
    };
    const abort = () => this.retire(entry, initial.signal.reason);
    initial.signal.addEventListener("abort", abort, { once: true });
    entry.detach = () => initial.signal.removeEventListener("abort", abort);
    this.entries.set(entry.id, entry);
    hostRequests++;
    let rejectCancelled!: (reason: unknown) => void;
    const cancelled = new Promise<never>((_, reject) => { rejectCancelled = reject; });
    const stopWaiting = () => rejectCancelled(controller.signal.reason);
    controller.signal.addEventListener("abort", stopWaiting, { once: true });
    if (controller.signal.aborted) stopWaiting();
    try {
      const response = await Promise.race([entry.opening, cancelled]);
      this.assertOpen(entry);
      entry.reader = response.body?.getReader();
      // openStream is a separate operation from reads. fetch retains its caller
      // cancellation below, while the stream has explicit close + absolute TTL.
      entry.detach();
      return { id: entry.id, status: response.status, statusText: response.statusText,
        url: response.url, redirected: response.redirected, headers: [...response.headers], expiresAt };
    } catch (error) {
      this.retire(entry, error);
      throw entry.error ?? error;
    } finally {
      controller.signal.removeEventListener("abort", stopWaiting);
    }
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const initial = new Request(input, init);
    const info = await this.open(initial, undefined, MAX_PLUGIN_NETWORK_BODY_BYTES);
    const entry = this.entries.get(info.id);
    if (!entry) throw new AppError("plugin/network-closed", "Network response has already closed");
    const abort = () => this.retire(entry, initial.signal.reason);
    initial.signal.addEventListener("abort", abort, { once: true });
    entry.detach = () => initial.signal.removeEventListener("abort", abort);
    if (initial.signal.aborted) abort();
    this.assertOpen(entry);
    let offset = 0;
    const body = entry.reader ? new ReadableStream<Uint8Array>({
      pull: async controller => {
        try {
          const chunk = await this.read(info.id, offset);
          offset += chunk.bytes.byteLength;
          if (chunk.done) controller.close();
          else controller.enqueue(new Uint8Array(chunk.bytes));
        } catch (error) { controller.error(error); }
      },
      cancel: () => this.close(info.id),
    }, { highWaterMark: 0 }) : null;
    if (!body) await this.close(info.id);
    const response = new Response(body, { status: info.status, statusText: info.statusText, headers: info.headers });
    Object.defineProperties(response, { url: { value: info.url }, redirected: { value: info.redirected } });
    return response;
  }

  read(id: string, offset: number, maxBytes = 64 * 1024): Promise<PluginNetworkChunk> {
    const entry = this.entries.get(id);
    if (!entry) return Promise.reject(new AppError("plugin/network-closed", "Network response is closed or belongs to another activation"));
    try {
      this.assertOpen(entry);
      if (!Number.isSafeInteger(offset) || offset !== entry.offset || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > this.limits.maxChunkBytes) {
        throw new AppError("plugin/network-read-invalid", "Network reads require the next offset and a valid chunk size");
      }
      if (entry.read) throw new AppError("plugin/network-busy", "A read is already pending for this response", { retryable: true });
    } catch (error) { return Promise.reject(error); }
    const pending = this.readNext(entry, maxBytes);
    entry.read = pending;
    void pending.then(() => { entry.read = undefined; }, () => { entry.read = undefined; });
    return pending;
  }

  private async readNext(entry: Entry, maxBytes: number): Promise<PluginNetworkChunk> {
    try {
      while (entry.buffered.byteLength === 0) {
        const next: ReadableStreamReadResult<Uint8Array> = entry.reader ? await entry.reader.read() : { done: true, value: undefined };
        this.assertOpen(entry);
        if (next.done) {
          this.retire(entry);
          return { offset: entry.offset, bytes: new ArrayBuffer(0), done: true };
        }
        entry.received += next.value.byteLength;
        if (entry.received > entry.limit || next.value.byteLength > MAX_PLUGIN_NETWORK_BODY_BYTES) {
          throw new AppError("plugin/payload-too-large", "Network response exceeds its byte limit");
        }
        entry.buffered = next.value;
      }
      const size = Math.min(maxBytes, entry.buffered.byteLength);
      const bytes = new Uint8Array(size);
      bytes.set(entry.buffered.subarray(0, size));
      entry.buffered = size === entry.buffered.byteLength ? new Uint8Array(0) : entry.buffered.subarray(size);
      const offset = entry.offset;
      entry.offset += size;
      return { offset, bytes: bytes.buffer, done: false };
    } catch (error) {
      const failure = entry.closed ? entry.error ?? error : error;
      this.retire(entry, failure);
      throw failure;
    }
  }

  close(id: string): Promise<void> {
    const entry = this.entries.get(id);
    return entry ? this.retire(entry) : Promise.resolve();
  }

  private assertOpen(entry: Entry): void {
    if (!entry.closed && Date.now() >= entry.expiresAt) this.retire(entry, new AppError("plugin/network-timeout", "Network response lifetime expired"));
    if (entry.closed) throw entry.error ?? new AppError("plugin/network-closed", "Network response is closed");
    this.signal.throwIfAborted();
    entry.controller.signal.throwIfAborted();
  }

  private retire(entry: Entry, error?: unknown): Promise<void> {
    if (entry.closed) return entry.cleanup!;
    entry.closed = true;
    entry.error = error ?? new AppError("plugin/network-closed", "Network response is closed");
    clearTimeout(entry.timer);
    entry.detach();
    entry.controller.abort(entry.error);
    // Keep the slot until even an abort-ignoring native operation has settled.
    const cleanup = Promise.resolve().then(async () => {
      const response = await entry.opening.catch(() => undefined);
      try {
        if (entry.reader) await entry.reader.cancel(entry.error);
        else await response?.body?.cancel(entry.error);
      } catch {
        // Aborting native fetch may already have errored and disposed its body.
      } finally {
        await entry.read?.catch(() => {}); // Read errors are delivered to their caller.
        entry.reader?.releaseLock();
      }
    }).finally(() => {
      entry.buffered = new Uint8Array(0);
      this.entries.delete(entry.id);
      hostRequests--;
    });
    entry.cleanup = cleanup;
    this.trackCleanup(cleanup);
    return cleanup;
  }
}
