import { MagnifyingGlass } from "@phosphor-icons/react";
import {
  CONTRIBUTION_CATALOG,
  DECLARATIVE_SCHEMA_CATALOG,
  DOMAIN_CATALOG,
  HOST_SERVICE_CATALOG,
} from "@read-aware/core";
import { useMemo, useState } from "react";

export type PluginCapabilityFamily =
  | "domains"
  | "contributions"
  | "services"
  | "schemas";

type Authority = "permission" | "permission-free" | "settings-grant";
type PluginCapabilityKey =
  | `domains:${keyof typeof DOMAIN_CATALOG}`
  | `contributions:${keyof typeof CONTRIBUTION_CATALOG}`
  | `services:${keyof typeof HOST_SERVICE_CATALOG}`
  | `schemas:${keyof typeof DECLARATIVE_SCHEMA_CATALOG}`;

const CAPABILITIES: Array<{
  family: PluginCapabilityFamily;
  id: string;
  version: string;
  permission: string | null;
  authority: Authority;
}> = [
  ...Object.entries(DOMAIN_CATALOG).map(([id, definition]) => ({
    family: "domains" as const,
    id,
    version: definition.version,
    permission:
      id === "settings"
        ? "settingsAccess"
        : definition.pluginAccess.map((access) => `${id}:${access}`).join(" / "),
    authority: id === "settings" ? ("settings-grant" as const) : ("permission" as const),
  })),
  ...Object.entries(CONTRIBUTION_CATALOG).map(([id, definition]) => ({
    family: "contributions" as const,
    id,
    version: definition.version,
    permission: definition.permission,
    authority: definition.permission ? ("permission" as const) : ("permission-free" as const),
  })),
  ...Object.entries(HOST_SERVICE_CATALOG).map(([id, definition]) => ({
    family: "services" as const,
    id,
    version: definition.version,
    permission: definition.permission,
    authority: definition.permission ? ("permission" as const) : ("permission-free" as const),
  })),
  ...Object.entries(DECLARATIVE_SCHEMA_CATALOG).map(([id, definition]) => ({
    family: "schemas" as const,
    id,
    version: definition.version,
    permission: null,
    authority: "permission-free" as const,
  })),
];

export type PluginCapabilityBrowserCopy = {
  searchLabel: string;
  searchPlaceholder: string;
  familyLabel: string;
  authorityLabel: string;
  allFamilies: string;
  allAuthorities: string;
  familyNames: Record<PluginCapabilityFamily, string>;
  authorityNames: Record<Authority, string>;
  permissionFree: string;
  versionLabel: string;
  permissionLabel: string;
  capabilityLabel: string;
  purposeLabel: string;
  hostOwnsLabel: string;
  result: (count: number) => string;
  noResults: string;
  descriptions: Record<PluginCapabilityKey, { purpose: string; hostOwns: string }>;
};

export function PluginCapabilityBrowser({
  copy,
}: {
  copy: PluginCapabilityBrowserCopy;
}) {
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState<PluginCapabilityFamily | "all">("all");
  const [authority, setAuthority] = useState<Authority | "all">("all");

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return CAPABILITIES.filter((capability) => {
      if (family !== "all" && capability.family !== family) return false;
      if (authority !== "all" && capability.authority !== authority) return false;
      if (!normalized) return true;
      const description = copy.descriptions[
        `${capability.family}:${capability.id}` as PluginCapabilityKey
      ];
      return [
        capability.id,
        capability.family,
        capability.permission ?? copy.permissionFree,
        description?.purpose ?? "",
        description?.hostOwns ?? "",
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });
  }, [authority, copy.descriptions, copy.permissionFree, family, query]);

  return (
    <div className="mt-6 border-y border-border-strong py-5">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_11rem]">
        <label className="block text-sm text-fg-muted">
          <span className="sr-only">{copy.searchLabel}</span>
          <span className="relative block">
            <MagnifyingGlass
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
              size={18}
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={copy.searchPlaceholder}
              className="h-11 w-full border border-border-strong bg-surface pl-10 pr-3 text-fg outline-none transition-colors placeholder:text-fg-subtle focus:border-fg-muted"
            />
          </span>
        </label>
        <label className="block">
          <span className="sr-only">{copy.familyLabel}</span>
          <select
            value={family}
            onChange={(event) =>
              setFamily(event.target.value as PluginCapabilityFamily | "all")
            }
            className="h-11 w-full border border-border-strong bg-surface px-3 text-sm text-fg outline-none focus:border-fg-muted"
          >
            <option value="all">{copy.allFamilies}</option>
            {Object.entries(copy.familyNames).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="sr-only">{copy.authorityLabel}</span>
          <select
            value={authority}
            onChange={(event) => setAuthority(event.target.value as Authority | "all")}
            className="h-11 w-full border border-border-strong bg-surface px-3 text-sm text-fg outline-none focus:border-fg-muted"
          >
            <option value="all">{copy.allAuthorities}</option>
            {Object.entries(copy.authorityNames).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      </div>

      <p className="mt-3 text-sm text-fg-muted" aria-live="polite">
        {copy.result(results.length)}
      </p>

      {results.length > 0 ? (
        <div className="mt-2 divide-y divide-border">
          <h3 className="sr-only">{copy.capabilityLabel}</h3>
          {results.map((capability) => {
            const description = copy.descriptions[
              `${capability.family}:${capability.id}` as PluginCapabilityKey
            ];
            return (
              <section
                key={`${capability.family}:${capability.id}`}
                className="py-4 sm:grid sm:grid-cols-[11rem_minmax(0,1fr)] sm:gap-5"
              >
                <div>
                  <code className="break-all">{capability.id}</code>
                  <span className="mt-1 block text-xs text-fg-subtle">
                    {copy.familyNames[capability.family]} · {copy.versionLabel} {capability.version}
                  </span>
                </div>
                <dl className="mt-3 grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm sm:mt-0">
                  <dt className="text-fg-muted">{copy.purposeLabel}</dt>
                  <dd>{description?.purpose}</dd>
                  <dt className="text-fg-muted">{copy.permissionLabel}</dt>
                  <dd><code className="break-all">{capability.permission ?? copy.permissionFree}</code></dd>
                  <dt className="text-fg-muted">{copy.hostOwnsLabel}</dt>
                  <dd>{description?.hostOwns}</dd>
                </dl>
              </section>
            );
          })}
        </div>
      ) : (
        <p className="mt-5 border-l-2 border-border-strong pl-4 text-fg-muted">
          {copy.noResults}
        </p>
      )}
    </div>
  );
}
