import { hostShutdown, type ShutdownCoordinator } from "../services/shutdown";
import { createLogger } from "./logger";
import { invoke } from "./ipc";
import { isTauri } from "./environment";

export type CloseAdapter = {
  onCloseRequested(handler: (event: { preventDefault(): void }) => Promise<void> | void): Promise<() => void>;
  onExitRequested(handler: () => Promise<void> | void): Promise<() => void>;
  destroy(): Promise<void>;
  confirmExit(): Promise<void>;
};

/** The native close button and app quit both wait for one coordinated flush; a second request
 * during the flush is absorbed, and a flush that fails or times out still lets the app close. */
export function createCloseCoordination(adapter: CloseAdapter, coordinator: Pick<ShutdownCoordinator, "prepare">, report: (message: string, error: unknown) => void) {
  let closing: Promise<void> | undefined;
  const finish = (complete: () => Promise<void>) => closing ??= (async () => {
    try { await coordinator.prepare(); }
    catch (error) { report("Shutdown preparation failed; closing anyway", error); }
    try { await complete(); }
    catch (error) { report("Native close after preparation failed", error); closing = undefined; }
  })();
  return {
    get closing() { return closing !== undefined; },
    closeRequested(event: { preventDefault(): void }) {
      // Never let the default close race the flush; the coordinated path destroys the window itself.
      event.preventDefault();
      return finish(() => adapter.destroy());
    },
    exitRequested() { return finish(() => adapter.confirmExit()); },
  };
}

export async function installCloseCoordination(adapter: CloseAdapter, coordinator: Pick<ShutdownCoordinator, "prepare">, report: (message: string, error: unknown) => void): Promise<() => void> {
  const coordination = createCloseCoordination(adapter, coordinator, report);
  const stops = [await adapter.onCloseRequested(event => coordination.closeRequested(event)), await adapter.onExitRequested(() => coordination.exitRequested())];
  return () => { for (const stop of stops) stop(); };
}

const log = createLogger("window-close");
/** Desktop only: the browser shell has no native window to coordinate. */
export async function installNativeCloseCoordination(): Promise<void> {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const { listen } = await import("@tauri-apps/api/event");
  const window = getCurrentWindow();
  if (window.label !== "main") return;
  await installCloseCoordination({
    onCloseRequested: handler => window.onCloseRequested(handler),
    onExitRequested: async handler => listen("app-exit-requested", () => { void handler(); }),
    destroy: () => window.destroy(),
    confirmExit: () => invoke("app_exit_confirm"),
  }, hostShutdown, (message, error) => log.error(message, error));
}
