/**
 * Imperative bridge into the React toast layer. `useToast` is context-bound;
 * plugin code (and the non-React host) needs a module-level dispatcher. The
 * `PluginToastBridge` component registers the live handler; before it mounts,
 * toasts fall back to the log rather than getting lost silently.
 *
 * Two channels, so failures can never render like successes:
 * - `showPluginToast` — plain notices or stable-code errors (`result.toast`,
 *   `services.ui.showToast`), with host-gated one-shot retry callbacks.
 * - `showPluginFailureToast` — a plugin threw. Renders localized failure copy
 *   (destructive variant); the raw error belongs in the log at the throw
 *   site, never in the toast.
 */
import { createLogger } from "../../../platform/logger";
import { AppError, errorCode } from "@read-aware/core";
import type { PluginToast } from "./plugin-types";
import { describeErrorCode } from "../../../i18n/describe-error";
import { pluginCallbackOwner, releasePluginCallbacks, retainPluginCallbacks } from "../runtime/plugin-callback-wire";

const log = createLogger("plugins");

export type PluginToastPayload =
  | { kind: "notice"; message: string }
  | { kind: "failure"; pluginName?: string; code?: string; retry?: () => void; onDismiss?: () => void };

type ToastHandler = (payload: PluginToastPayload) => unknown;

let handler: ToastHandler | null = null;
const active = new Set<() => void>();

export function setPluginToastHandler(next: ToastHandler | null): void {
  if (next !== handler) for (const dispose of [...active]) dispose();
  handler = next;
}

export function normalizePluginToast(input: PluginToast): PluginToast {
  const fail = (): never => { throw new AppError("plugin/invalid-input", "Invalid plugin toast"); };
  if (typeof input === "string") return input.length <= 16000 ? input : fail();
  if (!input || typeof input !== "object" || Array.isArray(input) || input.kind !== "error"
    || Object.keys(input).some(key => !["kind", "code", "retry"].includes(key))
    || typeof input.code !== "string" || !input.code.trim() || input.code.length > 128
    || input.retry !== undefined && typeof input.retry !== "function") return fail();
  return { kind: "error", code: input.code, ...(input.retry ? { retry: input.retry } : {}) };
}

/** Explicit notices retain their copy; errors use the host's stable-code policy. */
export function showPluginToast(input: PluginToast, lifetime?: AbortSignal): void {
  const value = normalizePluginToast(input);
  if (lifetime?.aborted) throw new AppError("plugin/cancelled", "Toast owner retired");
  if (typeof value === "string") {
    if (handler) handler({ kind: "notice", message: value }); else log.info("toast:", value);
    return;
  }
  if (!handler) { log.warn("failure toast dropped (no handler)", value.code); return; }
  const retry = describeErrorCode(value.code)?.retryable ? value.retry : undefined;
  const owner = lifetime ?? (typeof input === "object" ? pluginCallbackOwner(input) : undefined) ?? (retry && pluginCallbackOwner(retry));
  if (owner?.aborted) return;
  while (active.size >= 16) active.values().next().value?.();
  const release = retainPluginCallbacks(retry);
  let disposed = false, dismiss: (() => void) | undefined;
  const dispose = () => {
    if (disposed) return;
    disposed = true; clearTimeout(timer); owner?.removeEventListener("abort", dispose); active.delete(dispose);
    try { release(); } catch (error) { log.warn("Toast callback cleanup failed", error); }
    try { dismiss?.(); } catch (error) { log.warn("Toast dismissal failed", error); }
  };
  const timer = setTimeout(dispose, 6000);
  active.add(dispose); owner?.addEventListener("abort", dispose, { once: true });
  const runRetry = retry ? () => {
    if (disposed || owner?.aborted) return;
    const releaseRun = retainPluginCallbacks(retry);
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true; clearTimeout(deadline); owner?.removeEventListener("abort", finish);
      try { releaseRun(); } catch (error) { log.warn("Toast retry callback cleanup failed", error); }
    };
    const deadline = setTimeout(finish, 10_000); owner?.addEventListener("abort", finish, { once: true });
    dispose();
    void Promise.resolve().then(() => {
      if (!settled && !owner?.aborted) return retry();
    }).then(result => releasePluginCallbacks(result)).catch(error => {
      if (owner?.aborted) return; // Retired callbacks do not generate late notices.
      log.warn("Plugin toast retry failed", error); showPluginFailureToast(undefined, error);
    }).finally(finish);
  } : undefined;
  try {
    const result = handler({ kind: "failure", code: value.code, retry: runRetry, onDismiss: dispose });
    if (typeof result === "function") { dismiss = () => { result(); }; if (disposed) dismiss(); }
  } catch (error) { dispose(); throw error; }
}

/** A plugin failed. Log the raw error where it was caught; this only notifies. */
export function showPluginFailureToast(pluginName?: string, error?: unknown): void {
  if (handler) handler({ kind: "failure", pluginName, code: errorCode(error) });
  else log.warn("failure toast dropped (no handler)", pluginName ?? "");
}
