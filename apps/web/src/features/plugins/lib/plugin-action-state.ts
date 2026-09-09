import { AppError } from "@read-aware/core";
import type { PluginActionState } from "./plugin-types";

export function normalizeActionState(raw: PluginActionState): PluginActionState {
  if (!raw || typeof raw !== "object" || !Number.isSafeInteger(raw.revision) || raw.revision < 0
    || typeof raw.visible !== "boolean" || typeof raw.enabled !== "boolean"
    || (raw.checked !== undefined && typeof raw.checked !== "boolean")) {
    throw new AppError("plugin/invalid-input", "Invalid contribution action state");
  }
  return { revision: raw.revision, visible: raw.visible, enabled: raw.enabled,
    ...(raw.checked === undefined ? {} : { checked: raw.checked }) };
}

export const actionVisible = (action: { state?: PluginActionState }) => action.state?.visible !== false;
export const actionEnabled = (action: { state?: PluginActionState }) => actionVisible(action) && action.state?.enabled !== false;
