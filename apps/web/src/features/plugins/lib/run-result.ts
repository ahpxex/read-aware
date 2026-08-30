/**
 * Central outcome handling for plugin contributions triggered outside a plugin
 * surface (selection actions, palette commands): silent, toast, or open a
 * Dialog. Errors surface as a toast — a broken plugin must never take the
 * reader down with it.
 */
import {
  closePluginDialog,
  failPluginDialog,
  openPluginDialog,
  resolvePluginDialog,
} from "../state/plugin-store";
import { errorCode } from "@read-aware/core";
import { showPluginFailureToast, showPluginToast } from "./plugin-toast";
import type { PluginViewResult } from "./plugin-types";
import { createLogger } from "../../../platform/logger";

const log = createLogger("plugins");

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
    log.error(`contribution from "${pluginId}" failed`, error);
    if (pendingDialogId) {
      // The user is looking at the dialog — fail it in place (with retry and
      // code-specific copy) instead of snapping it away for a corner toast.
      failPluginDialog(pendingDialogId, {
        code: errorCode(error),
        retry: () => void runPluginContribution(pluginId, pluginName, run, options),
      });
    } else {
      showPluginFailureToast(pluginName);
    }
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
