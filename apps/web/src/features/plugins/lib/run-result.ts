/**
 * Central outcome handling for plugin contributions triggered outside a plugin
 * surface (selection actions, palette commands): silent, toast, or open a
 * Dialog. Errors surface as a toast — a broken plugin must never take the
 * reader down with it.
 */
import {
  closePluginDialog,
  openPluginDialog,
  resolvePluginDialog,
} from "../state/plugin-store";
import { showPluginToast } from "./plugin-toast";
import type { PluginViewResult } from "./plugin-types";

export async function runPluginContribution(
  pluginId: string,
  pluginName: string,
  run: () => PluginViewResult | Promise<PluginViewResult>,
  options?: { presentation?: "dialog" },
): Promise<void> {
  const pendingDialogId = options?.presentation === "dialog"
    ? openPluginDialog({ pluginId, pluginName, view: null })
    : null;
  let result: PluginViewResult;
  try {
    result = await run();
  } catch (error) {
    if (pendingDialogId) closePluginDialog(pendingDialogId);
    console.error(`[plugins] contribution from "${pluginId}" failed`, error);
    showPluginToast(`${pluginName}: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  if (!result) {
    if (pendingDialogId) closePluginDialog(pendingDialogId);
    return;
  }
  if (result.toast) showPluginToast(result.toast);
  if (result.view) {
    if (pendingDialogId) resolvePluginDialog(pendingDialogId, result.view);
    else openPluginDialog({ pluginId, pluginName, view: result.view });
  } else if (pendingDialogId) {
    closePluginDialog(pendingDialogId);
  }
}
