/**
 * Last-chance capture of errors nothing else caught: window "error" events
 * and unhandled promise rejections. Both were previously invisible in
 * production (DevTools-only). They land in the file log through the logger
 * seam; behavior is otherwise unchanged — this observes, it never swallows.
 */
import { createLogger } from "./logger";

const log = createLogger("unhandled");

export function installGlobalErrorLogging(): void {
  window.addEventListener("error", (event) => {
    // Resource-load error events (img/script) carry no error and no message —
    // nothing actionable to record at this layer.
    if (!event.error && !event.message) return;
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
