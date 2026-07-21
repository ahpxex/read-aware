/**
 * Central outcome handling for plugin contributions triggered outside a plugin
 * surface (selection actions, palette commands): silent, toast, or open a
 * Dialog. Errors surface as a toast — a broken plugin must never take the
 * reader down with it.
 */
import { openPluginDialog } from "../state/plugin-store";
import { showPluginToast } from "./plugin-toast";
import type { PluginViewResult } from "./plugin-types";

export async function runPluginContribution(
  pluginId: string,
  pluginName: string,
  run: () => PluginViewResult | Promise<PluginViewResult>,
): Promise<void> {
  let result: PluginViewResult;
  try {
    result = await run();
  } catch (error) {
    console.error(`[plugins] contribution from "${pluginId}" failed`, error);
    showPluginToast(`${pluginName}: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  if (!result) return;
  if (result.toast) showPluginToast(result.toast);
  if (result.view) {
    openPluginDialog({ pluginId, pluginName, view: result.view });
  }
}
