/**
 * Opens a header action's view in the modal Dialog host — the container used
 * where an anchored popup can't live: overflow-menu entries and the phone
 * header menu. Fetch errors surface as a toast.
 */
import {
  failPluginDialog,
  openPluginDialog,
  resolvePluginDialog,
} from "../state/plugin-store";
import { errorCode } from "@read-aware/core";
import type { HeaderActionInput, RegisteredHeaderAction } from "./plugin-types";
import { createLogger } from "../../../platform/logger";

const log = createLogger("plugins");

export async function openHeaderActionDialog(
  action: RegisteredHeaderAction,
  input: HeaderActionInput,
): Promise<void> {
  const requestId = openPluginDialog({
    pluginId: action.pluginId,
    pluginName: action.pluginName,
    view: null,
  });
  try {
    const view = await action.view(input);
    resolvePluginDialog(requestId, view);
  } catch (error) {
    log.error(`header action "${action.key}" failed`, error);
    // Fail in place: the dialog is already on screen, so the error state (and
    // its retry) belongs inside it, not in a corner toast.
    failPluginDialog(requestId, {
      code: errorCode(error),
      retry: () => void openHeaderActionDialog(action, input),
    });
  }
}
