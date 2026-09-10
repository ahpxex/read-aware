import { AppError, resourceDownloadInput, RESOURCE_DOWNLOAD_MAX_BYTES, type ResourceDownloadInput, type ResourceDownloadReceipt, type ResourcePort } from "@read-aware/core";
import type { fetch as NativeFetch } from "@tauri-apps/plugin-http";
import { PLUGIN_NETWORK_LIMITS, PluginNetworkRequests } from "../features/plugins/runtime/plugin-network-requests";

const redirects = new Set([301, 302, 303, 307, 308]);

/** Downloads compose the existing request owner and conversation resource owner. */
export class ResourceDownloadService {
  private readonly active = new Set<string>();
  constructor(private readonly fetch: typeof NativeFetch, private readonly resources: (threadKey: string) => ResourcePort,
    private readonly report: (error: unknown) => void) {}

  async download(threadKey: string, raw: ResourceDownloadInput, signal?: AbortSignal): Promise<ResourceDownloadReceipt> {
    const input = resourceDownloadInput(raw);
    signal?.throwIfAborted();
    if (!threadKey.startsWith("global:") || threadKey.length > 512) throw new AppError("memory/forbidden", "Downloads require a global conversation");
    if (this.active.has(threadKey) || this.active.size >= 4) throw new AppError("plugin/network-busy", "Download capacity reached", { retryable: true });
    this.active.add(threadKey);
    const controller = new AbortController();
    const cancel = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => controller.abort(new AppError("plugin/network-timeout", "Download deadline exceeded")), 120_000);
    const cleanups: Promise<void>[] = [];
    const requests = new PluginNetworkRequests((_request, init) => this.fetch(input.url, {
      method: "GET", credentials: "omit", redirect: "manual", headers: new Headers(), signal: init.signal, maxRedirections: 0,
    }), controller.signal,
      cleanup => { cleanups.push(cleanup); }, { ...PLUGIN_NETWORK_LIMITS, maxConcurrentRequests: 1, maxStreamBytes: RESOURCE_DOWNLOAD_MAX_BYTES });
    let streamId: string | undefined, resourceId: string | undefined;
    let completed = false;
    let port: ResourcePort | undefined;
    try {
      port = this.resources(threadKey);
      const response = await requests.open(input.url, { method: "GET", credentials: "omit", redirect: "manual", signal: controller.signal });
      streamId = response.id;
      const headers = new Headers(response.headers);
      if (redirects.has(response.status)) {
        const location = headers.get("location");
        if (!location) return { status: "http-error", httpStatus: response.status };
        let destination: string;
        try { destination = new URL(location, input.url).href; }
        catch { throw new AppError("plugin/network-redirect", "Invalid download redirect"); }
        // Returning a destination does not authorize following it; a new tool call asks again.
        return { status: "redirect", url: resourceDownloadInput({ ...input, url: destination }).url, httpStatus: response.status };
      }
      if (response.status !== 200) return { status: "http-error", httpStatus: response.status };
      const declaredSize = headers.get("content-length");
      if (declaredSize && /^\d+$/.test(declaredSize) && Number(declaredSize) > RESOURCE_DOWNLOAD_MAX_BYTES) {
        throw new AppError("plugin/payload-too-large", "Download exceeds 64 MiB");
      }
      const candidateMime = headers.get("content-type")?.split(";")[0]?.trim();
      const mimeType = candidateMime && candidateMime.length <= 256 && /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(candidateMime)
        ? candidateMime : "application/octet-stream";
      const resource = await port.create({ name: input.name, mimeType }, controller.signal);
      resourceId = resource.id;
      let offset = 0;
      for (;;) {
        controller.signal.throwIfAborted();
        const chunk = await requests.read(streamId, offset, 64 * 1024);
        controller.signal.throwIfAborted();
        if (chunk.done) break;
        await port.append(resourceId, offset, chunk.bytes, controller.signal);
        offset += chunk.bytes.byteLength;
      }
      const sealed = await port.commit(resourceId, controller.signal);
      controller.signal.throwIfAborted();
      completed = true;
      return { status: "downloaded", resource: sealed };
    } finally {
      clearTimeout(timer); signal?.removeEventListener("abort", cancel);
      const aborted = controller.signal.aborted ? controller.signal.reason : undefined;
      controller.abort();
      try {
        if (streamId) await requests.close(streamId);
        await Promise.all(cleanups);
        if (completed) {
          if (aborted !== undefined) throw aborted;
          signal?.throwIfAborted();
          resourceId = undefined;
        }
      } finally {
        try {
          if (resourceId && port) await port.release(resourceId);
        } catch (error) { this.report(error); }
        this.active.delete(threadKey);
      }
    }
  }
}
