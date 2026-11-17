import { invoke } from "../platform/ipc";
import { AppError } from "@read-aware/core";
import { isTauri, isMobileOS } from "../platform/environment";
import { createLogger } from "../platform/logger";
import { HostWindowService } from "./window-controller";

const log = createLogger("window");
async function native<T>(run: (window: import("@tauri-apps/api/window").Window) => Promise<T>): Promise<T> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const window = getCurrentWindow();
    if (window.label !== "main") throw new AppError("ui/unavailable", "Only the main window is supported");
    return await run(window);
  } catch (error) {
    if (error instanceof AppError) throw error;
    log.warn("Native window request failed", error);
    throw new AppError("ipc/unknown", "Native window request failed");
  }
}

export const hostWindow = new HostWindowService(
  {
    supported: () => isTauri() && !isMobileOS(),
    inputRevision: () => invoke<number | null>("window_input_revision"),
    read: () =>
      native(async (window) => {
        const before = await invoke<number | null>("window_input_revision");
        const [minimized, maximized, fullscreen, focused, size, scale] = await Promise.all([
          window.isMinimized(),
          window.isMaximized(),
          window.isFullscreen(),
          window.isFocused(),
          window.innerSize(),
          window.scaleFactor(),
        ]);
        const after = await invoke<number | null>("window_input_revision");
        return {
          minimized,
          maximized,
          fullscreen,
          focused,
          inputRevision: before === after ? after : null,
          viewport: { width: Math.round(size.width / scale), height: Math.round(size.height / scale) },
        };
      }),
    apply: (request, signal) =>
      native(async (window) => {
        signal?.throwIfAborted();
        if (request.action === "minimize") return window.minimize();
        if (request.action === "fullscreen") return window.setFullscreen(request.enabled);
        // Restore means the normal, visible window, not restoring arbitrary geometry.
        if (request.action === "restore") {
          await window.setFullscreen(false);
          signal?.throwIfAborted();
        }
        await window.unminimize();
        signal?.throwIfAborted();
        return request.action === "maximize" ? window.maximize() : window.unmaximize();
      }),
    watch: (changed) =>
      native(async (window) => {
        const stops: Array<() => void> = [];
        try {
          // Resizing covers maximize and fullscreen; focus covers minimize and restore.
          stops.push(await window.onResized(changed));
          stops.push(await window.onFocusChanged(changed));
        } catch (error) {
          for (const stop of stops.splice(0)) stop();
          // Only a window that cannot report its own changes is sampled instead.
          log.warn("Native window events unavailable; polling state", error);
          const timer = setInterval(changed, 1000);
          stops.push(() => clearInterval(timer));
        }
        return () => {
          for (const stop of stops) stop();
        };
      }),
  },
  (error) => log.warn("Window observation failed", error),
);
