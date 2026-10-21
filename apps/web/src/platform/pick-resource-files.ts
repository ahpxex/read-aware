import { AppError, type ResourcePickOptions } from "@read-aware/core";
import { open } from "@tauri-apps/plugin-dialog";
import { isAndroid } from "./environment";

let generation = 0;
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
    const request = ++generation;
    bridge.startResourcePick(request, options.multiple ?? false);
    const deadline = performance.now() + 10 * 60 * 1000;
    while (performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const result = bridge.takeResourcePickResult();
      if (result === null) continue;
      const [id, ...lines] = result.split("\n").filter(Boolean);
      if (Number(id) !== request) continue;
      signal?.throwIfAborted();
      if (lines.some((line) => line.startsWith("__ERROR__:")))
        throw new AppError("ui/unavailable", "The native resource picker failed");
      return lines.map((line) => {
        const [path, name] = line.split("\t");
        return { path, name: name || "File" };
      });
    }
    throw new AppError("ui/unavailable", "The native resource picker timed out");
  } finally {
    picking = false;
  }
}
