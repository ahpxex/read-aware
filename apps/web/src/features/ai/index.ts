/**
 * The AI feature's public surface for other features (see the
 * `features-via-public-index` dependency rule). Only what another feature
 * legitimately shares is exported here.
 */

// Plugin inference runs on the app's one agent runtime, not a parallel client.
export { getAgentRuntime } from "./agent/agent-runtime";

// The Agent page lists, opens and starts global threads.
export { activeGlobalThreadAtom } from "./state/global-thread";
export { newGlobalThreadId } from "./lib/conversation-store";
