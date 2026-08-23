import type { EventOrigin } from "./entities";

/** Canonical product settings vocabulary shared by UI, agent, and plugins. */
export type SettingsSection =
  | "general"
  | "appearance"
  | "reading"
  | "ai"
  | "menus"
  | "sync"
  | "plugins";

/** Values that can cross the generic settings domain boundary. */
export type SettingValue = string | number | boolean | null | string[];

export type SettingKind =
  | "boolean"
  | "enum"
  | "string"
  | "integer"
  | "number"
  | "id-list";

export interface SettingOption {
  value: SettingValue;
  label: string;
  source?: "builtin" | "plugin";
  pluginName?: string;
  polarity?: "light" | "dark";
}

export type SettingsTarget =
  | { kind: "global" }
  | { kind: "all-books" }
  | { kind: "book"; bookId: string };

export type SettingsQueryTarget = Exclude<SettingsTarget, { kind: "all-books" }>;

export interface SettingDescriptor {
  path: string;
  section: SettingsSection;
  label: string;
  description?: string;
  kind: SettingKind;
  value: SettingValue;
  writable: boolean;
  nullable?: boolean;
  options?: SettingOption[];
  supportedTargets?: Array<SettingsTarget["kind"]>;
}

export type SettingCatalogEntry = Omit<SettingDescriptor, "value">;

export interface SettingReadResult {
  path: string;
  value: SettingValue;
  target: SettingsQueryTarget;
}

/** Exact paths or an explicit `section.*` group. `*` means every path. */
export type SettingsPathPattern = string;

export interface SettingsAccessPolicy {
  discover?: readonly SettingsPathPattern[];
  read?: readonly SettingsPathPattern[];
  write?: readonly SettingsPathPattern[];
}

export interface SettingsOverrideSummary {
  target: { kind: "book"; bookId: string };
  paths: string[];
}

export interface SettingsQuery {
  section?: SettingsSection;
  target?: SettingsQueryTarget;
}

export interface SettingsSnapshot {
  target: SettingsQueryTarget;
  settings: SettingDescriptor[];
  overrides: SettingsOverrideSummary[];
}

export interface SettingChange {
  path: string;
  value: SettingValue;
  target?: SettingsTarget;
}

export interface SettingsUpdateResult {
  changed: SettingChange[];
  settings: SettingsSnapshot;
}

export interface SettingsChangedEvent {
  type: "settings.changed";
  origin: EventOrigin;
  changes: SettingChange[];
}
