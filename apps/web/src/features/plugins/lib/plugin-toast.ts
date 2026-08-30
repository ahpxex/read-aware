/**
 * Imperative bridge into the React toast layer. `useToast` is context-bound;
 * plugin code (and the non-React host) needs a module-level dispatcher. The
 * `PluginToastBridge` component registers the live handler; before it mounts,
 * toasts fall back to the log rather than getting lost silently.
 *
 * Two channels, so failures can never render like successes:
 * - `showPluginToast` — plugin-authored notices (`result.toast`,
 *   `services.ui.showToast`), neutral styling.
 * - `showPluginFailureToast` — a plugin threw. Renders localized failure copy
 *   (destructive variant); the raw error belongs in the log at the throw
 *   site, never in the toast.
 */
import { createLogger } from "../../../platform/logger";

const log = createLogger("plugins");

export type PluginToastPayload =
  | { kind: "notice"; message: string }
  | { kind: "failure"; pluginName?: string };

type ToastHandler = (payload: PluginToastPayload) => void;

let handler: ToastHandler | null = null;

export function setPluginToastHandler(next: ToastHandler | null): void {
  handler = next;
}

/** A plugin-authored notice (its own copy, its own responsibility). */
export function showPluginToast(message: string): void {
  if (handler) handler({ kind: "notice", message });
  else log.info("toast:", message);
}

/** A plugin failed. Log the raw error where it was caught; this only notifies. */
export function showPluginFailureToast(pluginName?: string): void {
  if (handler) handler({ kind: "failure", pluginName });
  else log.warn("failure toast dropped (no handler)", pluginName ?? "");
}
