/**
 * Last-chance capture of errors nothing else caught: window "error" events
 * and unhandled promise rejections. Both were previously invisible in
 * production (DevTools-only). They land in the file log through the logger
 * seam; behavior is otherwise unchanged — this observes, it never swallows.
 */
import { createLogger } from "./logger";

const log = createLogger("unhandled");

/**
 * The ResizeObserver spec reports a loop that leaves notifications for the
 * next frame as an error event with no error object ("ResizeObserver loop
 * limit exceeded" in older Chromium WebViews and "ResizeObserver loop completed
 * with undelivered notifications." in current Chromium and WebKit). Nothing threw:
 * the skipped sizes are delivered on the next frame. Recording it as an
 * uncaught error filled the logs of Android tablets and the desktop app with
 * noise that buried real failures.
 */
export function isResizeObserverLoopNotice(event: Pick<ErrorEvent, "error" | "message">): boolean {
  return !event.error && /^ResizeObserver loop\b/.test(event.message);
}

export function installGlobalErrorLogging(): void {
  window.addEventListener("error", (event) => {
    // Resource-load error events (img/script) carry no error and no message —
    // nothing actionable to record at this layer.
    if (!event.error && !event.message) return;
    if (isResizeObserverLoopNotice(event)) {
      log.debug(event.message);
      return;
    }
    const where = event.filename ? ` at ${event.filename}:${event.lineno}:${event.colno}` : "";
    if (event.error) {
      log.error(`uncaught error${where}`, event.error);
    } else {
      log.error(`uncaught error${where}: ${event.message}`);
    }
  });

  window.addEventListener("unhandledrejection", (event) => {
    log.error("unhandled promise rejection", event.reason);
  });
}
