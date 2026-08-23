/**
 * Agent-facing aliases of the product Settings Domain contract.
 * The canonical vocabulary lives in @read-aware/core; the Agent does not own
 * a parallel settings model.
 */
export type {
  SettingChange as AgentSettingChange,
  SettingDescriptor as AgentSettingDescriptor,
  SettingKind as AgentSettingKind,
  SettingOption as AgentSettingOption,
  SettingValue as AgentSettingValue,
  SettingsOverrideSummary as AgentSettingsOverrideSummary,
  SettingsQuery as AgentSettingsQuery,
  SettingsQueryTarget as AgentSettingsQueryTarget,
  SettingsSection as AgentSettingsSection,
  SettingsSnapshot as AgentSettingsSnapshot,
  SettingsTarget as AgentSettingsTarget,
  SettingsUpdateResult as AgentSettingsUpdateResult,
} from "@read-aware/core";
