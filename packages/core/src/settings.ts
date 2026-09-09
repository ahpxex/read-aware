import type { EventOrigin } from "./entities";

/** Canonical product settings vocabulary shared by UI, agent, and plugins. */
export type SettingsSection =
  | "general"
  | "shelf"
  | "shortcuts"
  | "appearance"
  | "reading"
  | "annotations"
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
  | "id-list"
  | "key-chord";

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
  /** Read-only metadata for key-chord values. Null writes restore the default. */
  shortcut?: {
    defaultBinding: string[] | null;
    overridden: boolean;
    available: boolean;
    /** Binding is suspended even when conflicting paths are hidden by grants. */
    conflicted: boolean;
    conflicts: string[];
  };
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
  /** Process-local catalog/value revision. Not a sync clock or durable event sequence. */
  revision: number;
  target: SettingsQueryTarget;
  settings: SettingDescriptor[];
  overrides: SettingsOverrideSummary[];
}

export type SettingsObservationCause = {
  source: "initial" | "local" | "remote" | "restore" | "catalog" | "mixed";
  /** Null for legacy writes, remote origin unknown, catalog changes, or coalesced actors. */
  origin: EventOrigin | null;
};
export type SettingsObservation = SettingsObservationCause & (
  | { status: "ready"; snapshot: SettingsSnapshot }
  | { status: "error"; revision: number; code: string }
);

export interface SettingChange {
  path: string;
  value: SettingValue;
  target?: SettingsTarget;
}

export interface SettingsUpdateResult {
  /** Returned only after the entire validated settings command commits locally. */
  changed: SettingChange[];
  settings: SettingsSnapshot;
}

export interface SettingsChangedEvent {
  type: "settings.changed";
  origin: EventOrigin;
  changes: SettingChange[];
}
