import type { SettingsPort } from "@read-aware/agent";
import { createDomainApi } from "../../../../domain";

/** Agent adapter over the product-owned Settings Domain. */
export function createSettingsPort(): SettingsPort {
  const settings = createDomainApi("agent").settings;
  return {
    getSettings: settings.queries.snapshot,
    updateSettings: settings.commands.update,
  };
}
