import type { ClientIdentity } from "@earendil-works/pi-ai";

/**
 * How ReadAware's model requests identify the app to providers: OpenRouter's app
 * title and `HTTP-Referer` (its app rankings group by this URL), and the origin
 * headers of NVIDIA and OpenCode gateways. pi's own Agent default would credit
 * the traffic to pi instead.
 */
export const READAWARE_IDENTITY = {
  attribution: { name: "ReadAware", url: "https://readaware.app" },
} as const satisfies ClientIdentity;
