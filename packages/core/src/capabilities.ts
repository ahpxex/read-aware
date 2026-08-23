import {
  DOMAIN_CATALOG,
  DOMAIN_PERMISSIONS,
  type DomainPermission,
} from "./domains";

/** Host-owned extension points. A null permission means every plugin may use it. */
export const CONTRIBUTION_CATALOG = {
  selectionActions: { version: "1.0.0", permission: null },
  headerActions: { version: "1.0.0", permission: null },
  commands: { version: "1.0.0", permission: null },
  settingsOptions: { version: "1.0.0", permission: null },
  voiceProviders: { version: "1.0.0", permission: null },
  contentProviders: { version: "1.0.0", permission: null },
  readerModes: { version: "1.0.0", permission: "reader:modes" },
  agentTools: { version: "1.0.0", permission: "agent:tools" },
  themes: { version: "1.0.0", permission: "ui:themes" },
  fonts: { version: "1.0.0", permission: "ui:themes" },
} as const;

export type ContributionId = keyof typeof CONTRIBUTION_CATALOG;
export type ContributionPermission = Exclude<
  (typeof CONTRIBUTION_CATALOG)[ContributionId]["permission"],
  null
>;

/** Bounded host facilities. Core local services need no additional consent. */
export const HOST_SERVICE_CATALOG = {
  storage: { version: "1.0.0", permission: null },
  secrets: { version: "1.0.0", permission: null },
  ui: { version: "1.0.0", permission: null },
  schedules: { version: "1.0.0", permission: null },
  session: { version: "1.0.0", permission: null },
  network: { version: "1.0.0", permission: "service:network" },
  llm: { version: "1.0.0", permission: "service:llm" },
  clipboard: { version: "1.0.0", permission: "service:clipboard" },
} as const;

export type HostServiceId = keyof typeof HOST_SERVICE_CATALOG;
export type HostServicePermission = Exclude<
  (typeof HOST_SERVICE_CATALOG)[HostServiceId]["permission"],
  null
>;

/** Host-rendered declaration grammars, versioned apart from executable APIs. */
export const DECLARATIVE_SCHEMA_CATALOG = {
  views: { version: "1.0.0" },
  settings: { version: "1.0.0" },
  themes: { version: "1.0.0" },
} as const;

export type DeclarativeSchemaId = keyof typeof DECLARATIVE_SCHEMA_CATALOG;

/** The complete host catalog. Actor views filter this without copying versions. */
export const HOST_CAPABILITY_CATALOG = {
  domains: DOMAIN_CATALOG,
  contributions: CONTRIBUTION_CATALOG,
  services: HOST_SERVICE_CATALOG,
  schemas: DECLARATIVE_SCHEMA_CATALOG,
} as const;

export type PluginPermission =
  | DomainPermission
  | ContributionPermission
  | HostServicePermission;

function declaredPermissions<
  TCatalog extends Record<string, { permission: string | null }>,
>(catalog: TCatalog): Array<Exclude<TCatalog[keyof TCatalog]["permission"], null>> {
  return [...new Set(Object.values(catalog).flatMap((entry) =>
    entry.permission === null ? [] : [entry.permission]
  ))] as Array<Exclude<TCatalog[keyof TCatalog]["permission"], null>>;
}

/** The manifest vocabulary, wholly derived from the three capability families. */
export const PLUGIN_PERMISSIONS: readonly PluginPermission[] = [
  ...DOMAIN_PERMISSIONS,
  ...declaredPermissions(CONTRIBUTION_CATALOG),
  ...declaredPermissions(HOST_SERVICE_CATALOG),
];

export function permissionForContribution(
  id: ContributionId,
): ContributionPermission | null {
  return CONTRIBUTION_CATALOG[id].permission;
}

export function permissionForHostService(
  id: HostServiceId,
): HostServicePermission | null {
  return HOST_SERVICE_CATALOG[id].permission;
}

export function canUseContribution(
  id: ContributionId,
  permissions: ReadonlySet<string>,
): boolean {
  const permission = permissionForContribution(id);
  return permission === null || permissions.has(permission);
}

export function canUseHostService(
  id: HostServiceId,
  permissions: ReadonlySet<string>,
): boolean {
  const permission = permissionForHostService(id);
  return permission === null || permissions.has(permission);
}
