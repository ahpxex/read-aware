import type { PluginToast } from "@read-aware/plugin-types";

/** Test probes encode JSON in legacy notices, never in structured error toasts. */
export function parseProbeToast(value: PluginToast | undefined): ReturnType<typeof JSON.parse> {
  if (typeof value !== "string") throw new Error("Expected a JSON probe notice, not an error toast");
  return JSON.parse(value);
}
