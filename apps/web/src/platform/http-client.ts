import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { AgentFetch } from "@read-aware/agent";

/** Native HTTP transport for product traffic that must not depend on WebView CORS. */
export const appHttpFetch: AgentFetch = (input, init) =>
  tauriFetch(input, init);
