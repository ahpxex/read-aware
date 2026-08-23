import { DOMAIN_PERMISSIONS, type DomainPermission } from "./domains";

/** Host-owned extension points. A null permission means every plugin may use it. */
export const CONTRIBUTION_CATALOG = {
  selectionActions: { permission: null },
  headerActions: { permission: null },
  commands: { permission: null },
  settingsOptions: { permission: null },
  voiceProviders: { permission: null },
  contentProviders: { permission: null },
  readerModes: { permission: "reader:modes" },
  agentTools: { permission: "agent:tools" },
  themes: { permission: "ui:themes" },
  fonts: { permission: "ui:themes" },
} as const;

export type ContributionId = keyof typeof CONTRIBUTION_CATALOG;
export type ContributionPermission = Exclude<
  (typeof CONTRIBUTION_CATALOG)[ContributionId]["permission"],
  null
>;

/** Bounded host facilities. Core local services need no additional consent. */
export const HOST_SERVICE_CATALOG = {
  storage: { permission: null },
  secrets: { permission: null },
  ui: { permission: null },
  schedules: { permission: null },
  session: { permission: null },
  network: { permission: "service:network" },
  llm: { permission: "service:llm" },
  clipboard: { permission: "service:clipboard" },
} as const;

export type HostServiceId = keyof typeof HOST_SERVICE_CATALOG;
export type HostServicePermission = Exclude<
  (typeof HOST_SERVICE_CATALOG)[HostServiceId]["permission"],
  null
>;

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
