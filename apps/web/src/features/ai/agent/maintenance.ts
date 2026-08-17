import { getAgentRuntime } from "./agent-runtime";
import { createLogger } from "../../../platform/logger";

const log = createLogger("agent");

const CHECK_INTERVAL_MS = 5 * 60_000;
const IDLE_TIMEOUT_MS = 30_000;

function scheduleIdle(work: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(work, { timeout: IDLE_TIMEOUT_MS });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(work, 2_000);
  return () => window.clearTimeout(id);
}

/** Start low-priority memory maintenance for the lifetime of the desktop app. */
export function startAgentMaintenance(): () => void {
  let stopped = false;
  let cancelIdle: (() => void) | null = null;

  const run = async () => {
    cancelIdle = null;
    if (stopped || document.visibilityState === "hidden") return;
    try {
      await getAgentRuntime()?.consolidateIfNeeded();
    } catch (error) {
      // Maintenance is retried on the next idle tick and must never disturb chat.
      log.warn("memory consolidation failed", error);
    }
  };

  const queue = () => {
    if (stopped || cancelIdle || document.visibilityState === "hidden") return;
    cancelIdle = scheduleIdle(() => void run());
  };

  queue();
  const interval = window.setInterval(queue, CHECK_INTERVAL_MS);
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") queue();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    stopped = true;
    cancelIdle?.();
    window.clearInterval(interval);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
