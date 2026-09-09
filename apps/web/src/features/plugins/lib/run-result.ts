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
  pluginDialogAtom,
  resolvePluginDialog,
} from "../state/plugin-store";
import { errorCode } from "@read-aware/core";
import { getDefaultStore } from "jotai";
import { showPluginFailureToast, showPluginToast } from "./plugin-toast";
import type { PluginViewResult } from "./plugin-types";
import { createLogger } from "../../../platform/logger";
import { observePluginCallbackOwners, releasePluginCallbacks } from "../runtime/plugin-callback-wire";

const log = createLogger("plugins");

export async function runPluginContribution(
  pluginId: string,
  pluginName: string,
  run: () => PluginViewResult | Promise<PluginViewResult>,
  options?: { presentation?: "dialog"; owner?: unknown },
): Promise<void> {
  try { observePluginCallbackOwners(options?.owner ?? run, () => {})(); }
  catch (error) { log.warn("Contribution owner is unavailable", error); return; }
  const pendingDialogId = options?.presentation === "dialog"
    ? openPluginDialog({ pluginId, pluginName, view: null, owner: options?.owner ?? run })
    : null;
  let result: PluginViewResult;
  try {
    result = await run();
  } catch (error) {
    log.error(`contribution from "${pluginId}" failed`, error);
    // Retiring a Worker must not emit a late failure notification from its action.
    try { observePluginCallbackOwners(options?.owner ?? run, () => {})(); }
    catch { return; }
    if (pendingDialogId) {
      // The user is looking at the dialog — fail it in place (with retry and
      // code-specific copy) instead of snapping it away for a corner toast.
      failPluginDialog(pendingDialogId, {
        code: errorCode(error),
        retry: () => void runPluginContribution(pluginId, pluginName, run, options),
      });
    } else {
      showPluginFailureToast(pluginName, error);
    }
    return;
  }
  if (pendingDialogId) {
    // Resolving after dismiss/replacement must not produce a toast or reopen UI.
    if (getDefaultStore().get(pluginDialogAtom)?.requestId !== pendingDialogId) {
      releasePluginCallbacks(result);
      return;
    }
  }
  try { observePluginCallbackOwners([options?.owner ?? run, result], () => {})(); }
  catch (error) {
    log.warn("Contribution owner stopped before completion", error);
    releasePluginCallbacks(result);
    return;
  }
  if (!result) {
    if (pendingDialogId) closePluginDialog(pendingDialogId);
    return;
  }
  if (result.toast) showPluginToast(result.toast);
  if (result.view) {
    const accepted = pendingDialogId
      ? resolvePluginDialog(pendingDialogId, result.view)
      : openPluginDialog({ pluginId, pluginName, view: result.view, owner: options?.owner ?? run });
    releasePluginCallbacks(result, accepted ? result.view : undefined);
  } else if (pendingDialogId) {
    closePluginDialog(pendingDialogId);
    releasePluginCallbacks(result);
  } else {
    releasePluginCallbacks(result);
  }
}
