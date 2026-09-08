/** Network bodies cross the sandbox as bytes; platform Request/Response objects do not clone. */
export const MAX_PLUGIN_NETWORK_BODY_BYTES = 64 * 1024 * 1024;

export type PluginNetworkResponse = {
  status: number;
  statusText: string;
  url: string;
  headers: [string, string][];
  body: ArrayBuffer;
};

function aborted(signal?: AbortSignal | null): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Operation aborted", "AbortError");
}

async function readBody(
  stream: ReadableStream<Uint8Array> | null,
  signal?: AbortSignal | null,
  limit = MAX_PLUGIN_NETWORK_BODY_BYTES,
): Promise<ArrayBuffer> {
  aborted(signal);
  if (!stream) return new ArrayBuffer(0);
  const reader = stream.getReader();
  const cancel = () => {
    void reader.cancel(signal?.reason).catch(() => {
      // Cancellation is best effort on a stream that may have already errored.
    });
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      aborted(signal);
      const { done, value } = await reader.read();
      aborted(signal);
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        throw Object.assign(new Error("Plugin network body exceeds the transfer limit"), { code: "plugin/payload-too-large" });
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes.buffer;
  } catch (error) {
    void reader.cancel(error).catch(() => {
      // Preserve the read/limit error if disposing an already-failed stream also fails.
    });
    throw error;
  } finally {
    signal?.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

export async function flattenPluginRequest(input: RequestInfo | URL, init?: RequestInit) {
  // Request applies native inheritance/override rules, including FormData
  // boundaries and a Request input's method, headers, body and cancellation.
  const request = new Request(input, init);
  aborted(request.signal);
  const headers = [...request.headers.entries()];
  const body = request.body ? await readBody(request.body, request.signal) : undefined;
  aborted(request.signal);
  return {
    url: request.url,
    signal: request.signal,
    init: {
      method: request.method,
      headers,
      body,
      cache: request.cache,
      credentials: request.credentials,
      integrity: request.integrity,
      keepalive: request.keepalive,
      mode: request.mode,
      redirect: request.redirect,
      referrer: request.referrer,
      referrerPolicy: request.referrerPolicy,
    } satisfies RequestInit,
  };
}

export async function flattenPluginResponse(response: Response, signal?: AbortSignal, limit?: number): Promise<PluginNetworkResponse> {
  return {
    status: response.status,
    statusText: response.statusText,
    url: response.url,
    headers: [...response.headers.entries()],
    body: await readBody(response.body, signal, limit),
  };
}

export function restorePluginResponse(value: PluginNetworkResponse): Response {
  const response = new Response([101, 204, 205, 304].includes(value.status) ? null : value.body, {
    status: value.status,
    statusText: value.statusText,
    headers: value.headers,
  });
  Object.defineProperty(response, "url", { value: value.url });
  return response;
}
