import { AppError, type ResourcePickOptions } from "@read-aware/core";
import { open } from "@tauri-apps/plugin-dialog";
import { awaitParkedPick } from "./android-parked-pick";
import { isAndroid } from "./environment";

let picking = false;

/** Native resource descriptors stay inside the host. Android returns content
 * URIs with display names; resource_open_file materializes them natively. */
export async function pickResourceFiles(options: ResourcePickOptions, signal?: AbortSignal) {
  if (picking) throw new AppError("ui/unavailable", "A file picker is already open");
  picking = true;
  try {
    signal?.throwIfAborted();
    if (!isAndroid()) {
      const selected = await open({
        multiple: options.multiple ?? false,
        directory: false,
        ...(options.extensions?.length
          ? {
              filters: [
                { name: "Files", extensions: [...new Set(options.extensions.map((ext) => ext.split(".").at(-1)!))] },
              ],
            }
          : {}),
      });
      signal?.throwIfAborted();
      return (selected === null ? [] : Array.isArray(selected) ? selected : [selected]).map((path) => ({
        path,
        name: path.split(/[\\/]/).at(-1) || "File",
      }));
    }
    const bridge = window.ReadAwareAndroid;
    if (!bridge?.startResourcePick || !bridge.takeResourcePickResult)
      throw new AppError("ui/unavailable", "The native resource picker is unavailable");
    // Injected Java bridge methods must be called on the bridge object.
    const startResourcePick = bridge.startResourcePick.bind(bridge);
    const takeResourcePickResult = bridge.takeResourcePickResult.bind(bridge);
    const lines = await awaitParkedPick(
      {
        start: (generation) => startResourcePick(generation, options.multiple ?? false),
        take: () => takeResourcePickResult(),
      },
      signal,
    );
    return lines.map((line) => {
      const [path, name] = line.split("\t");
      return { path, name: name || "File" };
    });
  } finally {
    picking = false;
  }
}
