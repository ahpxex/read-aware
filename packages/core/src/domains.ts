/** Canonical roster of product domains that may be exposed programmatically. */
export const DOMAIN_CATALOG = {
  library: { version: "1.0.0", pluginAccess: ["read", "write"] },
  reading: { version: "1.0.0", pluginAccess: ["read", "write"] },
  annotations: { version: "1.0.0", pluginAccess: ["read", "write"] },
  conversations: { version: "1.0.0", pluginAccess: ["read"] },
  settings: { version: "1.0.0", pluginAccess: [] },
} as const;

export type DomainId = keyof typeof DOMAIN_CATALOG;
export type DomainAccess = "read" | "write";

export type DomainPermission = {
  [K in DomainId]: (typeof DOMAIN_CATALOG)[K]["pluginAccess"][number] extends infer TAccess
    ? TAccess extends DomainAccess
      ? `${K}:${TAccess}`
      : never
    : never;
}[DomainId];

export const DOMAIN_PERMISSIONS = Object.entries(DOMAIN_CATALOG).flatMap(
  ([domain, definition]) =>
    definition.pluginAccess.map((access) => `${domain}:${access}` as DomainPermission),
);

export type DomainGrants = Partial<Record<DomainId, DomainAccess>>;

/** Write implies read; duplicate declarations collapse to the stronger grant. */
export function domainGrantsFromPermissions(
  permissions: readonly string[],
): DomainGrants {
  const grants: DomainGrants = {};
  const known = new Set<string>(DOMAIN_PERMISSIONS);
  for (const permission of permissions) {
    if (!known.has(permission)) continue;
    const [domain, access] = permission.split(":") as [DomainId, DomainAccess];
    if (access === "write" || !grants[domain]) grants[domain] = access;
  }
  return grants;
}
