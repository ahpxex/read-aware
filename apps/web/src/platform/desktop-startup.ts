import { AppError } from "@read-aware/core";
import { isMobileOS, isTauri } from "./environment";
import { invoke } from "./ipc";

/** Mutation belongs to the native KV transaction, never a post-save effect. */
export const desktopStartup = {
  supported: () => isTauri() && !isMobileOS(),
  async read(): Promise<boolean> {
    if (!desktopStartup.supported()) throw new AppError("ui/unavailable", "Startup registration requires desktop");
    const enabled = await invoke<unknown>("desktop_startup_enabled");
    if (typeof enabled !== "boolean") throw new AppError("settings/unavailable", "Invalid native startup status");
    return enabled;
  },
};
