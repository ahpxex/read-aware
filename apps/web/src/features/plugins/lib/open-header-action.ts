/**
 * Opens a header action's view in the modal Dialog host — the container used
 * where an anchored popup can't live: overflow-menu entries and the phone
 * header menu. Fetch errors surface as a toast.
 */
import {
  closePluginDialog,
  openPluginDialog,
  resolvePluginDialog,
} from "../state/plugin-store";
import { showPluginToast } from "./plugin-toast";
import type { HeaderActionInput, RegisteredHeaderAction } from "./plugin-types";

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
    closePluginDialog(requestId);
    console.error(`[plugins] header action "${action.key}" failed`, error);
    showPluginToast(
      `${action.pluginName}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
