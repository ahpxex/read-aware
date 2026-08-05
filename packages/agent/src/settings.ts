export type AgentSettingsSection =
  | "general"
  | "appearance"
  | "reading"
  | "ai"
  | "menus"
  | "plugins";

/** Values that can cross the generic settings tool boundary. Lists carry
 *  ordered id arrays (menu surface layouts). */
export type AgentSettingValue = string | number | boolean | null | string[];

export type AgentSettingKind =
  | "boolean"
  | "enum"
  | "string"
  | "integer"
  | "number"
  | "id-list";

export interface AgentSettingOption {
  value: AgentSettingValue;
  label: string;
  /** Optional provenance for dynamic choices such as plugin contributions. */
  source?: "builtin" | "plugin";
  pluginName?: string;
  polarity?: "light" | "dark";
}

export type AgentSettingsTarget =
  { kind: "global" } | { kind: "all-books" } | { kind: "book"; bookId: string };

export type AgentSettingsQueryTarget = Exclude<
  AgentSettingsTarget,
  { kind: "all-books" }
>;

/** One host-registered, non-sensitive setting visible to the agent. */
export interface AgentSettingDescriptor {
  /** Stable dotted path passed back to update_settings. */
  path: string;
  section: AgentSettingsSection;
  label: string;
  description?: string;
  kind: AgentSettingKind;
  value: AgentSettingValue;
  writable: boolean;
  nullable?: boolean;
  options?: AgentSettingOption[];
  /** Targets accepted for writes to this path. Omitted for read-only values. */
  supportedTargets?: Array<AgentSettingsTarget["kind"]>;
}

export interface AgentSettingsOverrideSummary {
  target: { kind: "book"; bookId: string };
  /** Paths currently overridden for this target. */
  paths: string[];
}

export interface AgentSettingsQuery {
  section?: AgentSettingsSection;
  target?: AgentSettingsQueryTarget;
}

export interface AgentSettingsSnapshot {
  target: AgentSettingsQueryTarget;
  settings: AgentSettingDescriptor[];
  /** Active scoped overrides that can shadow global values. */
  overrides: AgentSettingsOverrideSummary[];
}

export interface AgentSettingChange {
  path: string;
  value: AgentSettingValue;
  /** Required when the descriptor supports more than one target; otherwise defaults to global. */
  target?: AgentSettingsTarget;
}

export interface AgentSettingsUpdateResult {
  changed: AgentSettingChange[];
  settings: AgentSettingsSnapshot;
}
