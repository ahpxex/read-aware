import type { FetchFunction } from "@earendil-works/pi-ai";

/** Host-provided HTTP transport. The agent stays independent of Tauri/browser APIs. */
export type AgentFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/**
 * pi types fetch as the runtime's complete global fetch object. Bun adds a
 * `preconnect` method to that type, while browser/Tauri transports only need
 * the standard call signature. Adapt the host function at this boundary.
 */
export function asProviderFetch(fetch?: AgentFetch): FetchFunction | undefined {
  if (!fetch) return undefined;

  const providerFetch = async (
    input: Parameters<FetchFunction>[0],
    init?: Parameters<FetchFunction>[1],
  ) => fetch(input as RequestInfo | URL, init as RequestInit | undefined);

  return Object.assign(providerFetch, { preconnect: () => undefined });
}
