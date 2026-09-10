import type { SettingsPort } from "@read-aware/agent";
import { createDomainApi } from "../../../../domain";

/** Agent adapter over the product-owned Settings Domain. */
export function createSettingsPort(): SettingsPort {
  const settings = createDomainApi("agent").settings;
  return {
    getModelCatalog: settings.queries.modelCatalog,
    refreshModelCatalog: settings.commands.refreshModelCatalog,
    getSettings: settings.queries.snapshot,
    getSettingOptions: settings.queries.options,
    updateSettings: settings.commands.update,
    resetReading: settings.commands.resetReading,
  };
}
