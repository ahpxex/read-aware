/**
 * Imperative bridge into the React toast layer. `useToast` is context-bound;
 * plugin code (and the non-React host) needs a module-level dispatcher. The
 * `PluginToastBridge` component registers the live handler; before it mounts,
 * toasts fall back to the console rather than getting lost silently.
 */

type ToastHandler = (message: string) => void;

let handler: ToastHandler | null = null;

export function setPluginToastHandler(next: ToastHandler | null): void {
  handler = next;
}

export function showPluginToast(message: string): void {
  if (handler) handler(message);
  else console.info("[plugins] toast:", message);
}
