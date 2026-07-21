/**
 * Opens a header action's view in the modal Dialog host — the container used
 * where an anchored popup can't live: overflow-menu entries and the phone
 * header menu. Fetch errors surface as a toast.
 */
import { openPluginDialog } from "../state/plugin-store";
import { showPluginToast } from "./plugin-toast";
import type { HeaderActionInput, RegisteredHeaderAction } from "./plugin-types";

export async function openHeaderActionDialog(
  action: RegisteredHeaderAction,
  input: HeaderActionInput,
): Promise<void> {
  try {
    const view = await action.view(input);
    openPluginDialog({ pluginId: action.pluginId, pluginName: action.pluginName, view });
  } catch (error) {
    console.error(`[plugins] header action "${action.key}" failed`, error);
    showPluginToast(
      `${action.pluginName}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
