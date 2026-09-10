import { AppError } from "@read-aware/core";
import type { PluginHostServices, PluginNetworkAccess } from "@read-aware/plugin-types";
import type { fetch as nativeFetch } from "@tauri-apps/plugin-http";
import { authorizePluginNetworkUrl, parsePluginNetworkAccess } from "../lib/plugin-network-policy";
import { flattenPluginRequest, MAX_PLUGIN_NETWORK_BODY_BYTES } from "./plugin-network-wire";
import type { PluginLifecycleController } from "./plugin-lifecycle";
import { PLUGIN_NETWORK_LIMITS, PluginNetworkRequests } from "./plugin-network-requests";

const MAX_REDIRECTS = 10;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export function createPluginNetworkService(
  access: PluginNetworkAccess | undefined,
  lifecycle: PluginLifecycleController,
  transport: typeof nativeFetch,
): NonNullable<PluginHostServices["network"]> {
  const { origins } = parsePluginNetworkAccess(access);
  const requests = new PluginNetworkRequests(fetch, lifecycle.signal, pending => lifecycle.trackCleanup(pending));

  async function fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    // Flattening also strips native-only proxy/TLS options from untrusted init.
    const initial = new Request(input, init);
    let url = authorizePluginNetworkUrl(origins, initial.url);
    const request = await flattenPluginRequest(initial);
    let method = request.init.method;
    let body = request.init.body;
    const headers = new Headers(request.init.headers);
    headers.delete("host");
    headers.delete("content-length");
    for (let redirects = 0; ; redirects++) {
      lifecycle.assertActive("services.network.fetch");
      request.signal.throwIfAborted();
      // Native auto-follow would evade per-hop grants. The installed transport
      // maps maxRedirections:0 to reqwest Policy::none(), exposing each 3xx.
      const response = await transport(url.href, {
        ...request.init, method, body, headers, signal: request.signal,
        maxRedirections: 0,
      });
      try {
        lifecycle.assertActive("services.network.fetch");
        request.signal.throwIfAborted();
        Object.defineProperty(response, "redirected", { value: redirects > 0 });
        if (!REDIRECT_STATUSES.has(response.status) || request.init.redirect === "manual") {
          return response;
        }
        if (request.init.redirect === "error") throw new AppError("plugin/network-redirect", "Redirect mode forbids following this response");
        const location = response.headers.get("location");
        if (location === null) return response;
        if (redirects === MAX_REDIRECTS) throw new AppError("plugin/network-redirect", "Redirect limit exceeded");
        let destination: URL;
        try { destination = new URL(location, url); }
        catch { throw new AppError("plugin/network-redirect", "Invalid redirect destination"); }
        authorizePluginNetworkUrl(origins, destination.href);
        if (url.protocol === "https:" && destination.protocol !== "https:") {
          throw new AppError("plugin/network-denied", "HTTPS downgrade redirects are not allowed");
        }
        if (destination.origin !== url.origin) {
          for (const name of ["authorization", "proxy-authorization", "cookie", "referer"]) headers.delete(name);
        }
        if (((response.status === 301 || response.status === 302) && method === "POST") ||
            (response.status === 303 && method !== "GET" && method !== "HEAD")) {
          method = "GET";
          body = undefined;
          for (const name of ["content-encoding", "content-language", "content-location", "content-type"]) headers.delete(name);
        }
        url = destination;
      } catch (error) {
        await discardResponse(response);
        throw error;
      }
      await discardResponse(response);
    }
  }

  return {
    policy: async () => {
      lifecycle.assertActive("services.network.policy");
      return { origins: [...origins], maxRedirects: MAX_REDIRECTS, maxBodyBytes: MAX_PLUGIN_NETWORK_BODY_BYTES, ...PLUGIN_NETWORK_LIMITS };
    },
    fetch: (input, init) => {
      lifecycle.assertActive("services.network.fetch");
      return requests.fetch(input, init);
    },
    openStream: (input, init) => {
      lifecycle.assertActive("services.network.openStream");
      return requests.open(input, init);
    },
    readStream: (id, offset, maxBytes) => {
      lifecycle.assertActive("services.network.readStream");
      return requests.read(id, offset, maxBytes);
    },
    closeStream: id => {
      lifecycle.assertActive("services.network.closeStream");
      return requests.close(id);
    },
  };
}

async function discardResponse(response: Response): Promise<void> {
  try { await response.body?.cancel(); }
  catch { /* Best-effort release of a redirect/error body; preserve the primary result. */ }
}
