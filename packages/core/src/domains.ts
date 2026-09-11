/** Canonical roster of product domains that may be exposed programmatically. */
export const DOMAIN_CATALOG = {
  library: { version: "1.18.0", pluginAccess: ["read", "write"] },
  reading: { version: "2.18.0", pluginAccess: ["read", "write"] },
  annotations: { version: "2.0.0", pluginAccess: ["read", "write"] },
  conversations: { version: "1.4.0", pluginAccess: ["read", "write"] },
  settings: { version: "1.10.0", pluginAccess: [] },
  memory: { version: "2.0.0", pluginAccess: ["read", "write"] },
} as const;

export type DomainId = keyof typeof DOMAIN_CATALOG;

/** A conservative reload hint. Revision orders this subscription's deliveries,
 * not database transactions; it is neither a cursor nor a conditional-write token. */
export type ProjectionInvalidation = {
  revision: number;
  source: "initial" | "local" | "host" | "remote" | "restore" | "mixed";
};
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
