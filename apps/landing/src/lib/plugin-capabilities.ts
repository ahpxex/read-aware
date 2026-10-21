import { HOST_CAPABILITY_CATALOG } from "@read-aware/core";
import reference from "./plugin-api.generated.json";
import released from "./released-capabilities.generated.json";

/** The latest app release's catalog (scripts/sync-plugin-dts.ts), beside the development one. */
export const RELEASED_APP_VERSION = released.appVersion;
const RELEASED_VERSIONS = released.capabilities as Record<string, Record<string, { version: string }>>;

export type CapabilityFamily = keyof typeof HOST_CAPABILITY_CATALOG;
export type CapabilityKey = {
  [F in CapabilityFamily]: `${F}:${keyof (typeof HOST_CAPABILITY_CATALOG)[F] & string}`;
}[CapabilityFamily];
export type CapabilityAuthority = "permission" | "permission-free" | "settings-grant";
export type CapabilityTopic = "reading" | "library" | "intelligence" | "automation" | "interface" | "integration";
export type CapabilityMethod = {
  path: string;
  signatures: string[];
  doc?: string;
  source: string;
  line: number;
};
export type CapabilityDescription = { purpose: string; hostOwns: string };
export type CapabilityDescriptions = Record<CapabilityKey, CapabilityDescription>;

const TOPICS: Record<CapabilityKey, CapabilityTopic[]> = {
  "domains:library": ["library", "reading"],
  "domains:reading": ["reading"],
  "domains:annotations": ["library", "reading"],
  "domains:conversations": ["intelligence"],
  "domains:settings": ["interface", "automation"],
  "domains:memory": ["intelligence"],
  "contributions:uriHandlers": ["integration", "interface"],
  "contributions:selectionActions": ["reading", "interface"],
  "contributions:headerActions": ["interface"],
  "contributions:contextActions": ["library", "interface"],
  "contributions:commands": ["interface", "automation"],
  "contributions:settingsOptions": ["interface"],
  "contributions:settingsPage": ["interface"],
  "contributions:voiceProviders": ["reading", "integration"],
  "contributions:contentProviders": ["library", "integration"],
  "contributions:readerModes": ["reading"],
  "contributions:agentTools": ["intelligence", "automation"],
  "contributions:agentContextProviders": ["intelligence"],
  "contributions:agentRetrievalProviders": ["intelligence"],
  "contributions:memoryCandidateProviders": ["intelligence"],
  "contributions:themes": ["interface"],
  "contributions:fonts": ["interface", "reading"],
  "contributions:syncTransports": ["integration"],
  "services:storage": ["automation", "integration"],
  "services:secrets": ["integration"],
  "services:ui": ["interface", "reading"],
  "services:schedules": ["automation"],
  "services:jobs": ["automation"],
  "services:changes": ["automation"],
  "services:transactions": ["automation"],
  "services:session": ["automation", "interface"],
  "services:plugins": ["automation", "integration"],
  "services:maintenance": ["integration"],
  "services:diagnostics": ["integration"],
  "services:logging": ["integration"],
  "services:resources": ["integration", "library"],
  "services:sync": ["integration"],
  "services:network": ["integration"],
  "services:llm": ["intelligence"],
  "services:clipboard": ["integration", "reading"],
  "schemas:views": ["interface"],
  "schemas:settings": ["interface"],
  "schemas:themes": ["interface"],
};

export type CapabilityEntry = {
  key: CapabilityKey;
  family: CapabilityFamily;
  id: string;
  /** The development catalog's version. */
  version: string;
  /** The version in the latest release; absent when that release does not offer it. */
  releasedVersion?: string;
  permissions: string[];
  authority: CapabilityAuthority;
  topics: CapabilityTopic[];
  methods: CapabilityMethod[];
  bundledOnly: boolean;
};

export const CAPABILITIES: CapabilityEntry[] = Object.entries(HOST_CAPABILITY_CATALOG).flatMap(([family, catalog]) =>
  Object.entries(catalog).map(([id, definition]) => {
    const key = `${family}:${id}` as CapabilityKey;
    // Theme schema admission uses the same explicit authority as theme contributions.
    const permissions =
      "pluginAccess" in definition
        ? definition.pluginAccess.map((access: string) => `${id}:${access}`)
        : "permission" in definition && definition.permission
          ? [definition.permission]
          : key === "schemas:themes"
            ? ["ui:themes"]
            : [];
    return {
      key,
      family: family as CapabilityFamily,
      id,
      version: definition.version,
      releasedVersion: RELEASED_VERSIONS[family]?.[id]?.version,
      permissions,
      authority:
        id === "settings" && family === "domains"
          ? ("settings-grant" as const)
          : permissions.length
            ? ("permission" as const)
            : ("permission-free" as const),
      topics: TOPICS[key],
      methods: (reference as Record<string, CapabilityMethod[]>)[key] ?? [],
      bundledOnly: key === "contributions:readerModes",
    };
  }),
);
export const API_METHOD_COUNT = CAPABILITIES.reduce((count, item) => count + item.methods.length, 0);
const KEYS = new Set<string>(CAPABILITIES.map((item) => item.key));
export const CAPABILITY_FAMILIES = Object.keys(HOST_CAPABILITY_CATALOG) as CapabilityFamily[];
export const CAPABILITY_TOPICS: CapabilityTopic[] = [
  "reading",
  "library",
  "intelligence",
  "automation",
  "interface",
  "integration",
];
export const CAPABILITY_AUTHORITIES: CapabilityAuthority[] = ["permission", "permission-free", "settings-grant"];
export type ExplorerSearch = {
  view?: "manifest";
  q?: string;
  family?: CapabilityFamily;
  authority?: CapabilityAuthority;
  topic?: CapabilityTopic;
  cap?: CapabilityKey;
};

export function validateExplorerSearch(input: Record<string, unknown>): ExplorerSearch {
  const member = <T extends string>(value: unknown, options: readonly T[]) =>
    typeof value === "string" && options.includes(value as T) ? (value as T) : undefined;
  return {
    view: input.view === "manifest" ? "manifest" : undefined,
    q: typeof input.q === "string" && input.q ? input.q.slice(0, 512) : undefined,
    family: member(input.family, CAPABILITY_FAMILIES),
    authority: member(input.authority, CAPABILITY_AUTHORITIES),
    topic: member(input.topic, CAPABILITY_TOPICS),
    cap: typeof input.cap === "string" && KEYS.has(input.cap) ? (input.cap as CapabilityKey) : undefined,
  };
}
export const normalizeSearchText = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

export function filterCapabilities(
  search: ExplorerSearch,
  descriptions: CapabilityDescriptions,
  topicNames: Record<CapabilityTopic, string>,
): CapabilityEntry[] {
  const terms = normalizeSearchText(search.q ?? "")
    .split(/\s+/)
    .filter(Boolean);
  return CAPABILITIES.filter((entry) => {
    if (
      (search.family && entry.family !== search.family) ||
      (search.authority && entry.authority !== search.authority) ||
      (search.topic && !entry.topics.includes(search.topic))
    )
      return false;
    const description = descriptions[entry.key];
    const haystack = normalizeSearchText(
      [
        entry.key,
        ...entry.permissions,
        ...entry.topics.map((topic) => topicNames[topic]),
        description.purpose,
        description.hostOwns,
        ...entry.methods.map((method) => method.path),
      ].join(" "),
    );
    return terms.every((term) => haystack.includes(term));
  });
}

/**
 * A starting fragment, not an inferred grant for every method in a capability.
 * It targets the latest release so a copied range activates on the app users
 * have; only capabilities that release lacks fall back to the development version.
 */
export function capabilityManifest(entry: CapabilityEntry, access: "read" | "write" = "read"): Record<string, unknown> {
  const fragment: Record<string, unknown> = {
    requires: { [entry.family]: { [entry.id]: `^${entry.releasedVersion ?? entry.version}` } },
  };
  const permissions =
    entry.family === "domains" && entry.permissions.length ? [`${entry.id}:${access}`] : entry.permissions;
  if (permissions.length) fragment.permissions = permissions;
  if (entry.key === "domains:settings") fragment.settingsAccess = { read: ["appearance.theme"] };
  if (entry.key === "services:network") fragment.networkAccess = { origins: ["https://api.example.com"] };
  return fragment;
}

export function groupCapabilityMethods(entry: CapabilityEntry, methods: CapabilityMethod[]) {
  const groups = new Map<string, (CapabilityMethod & { name: string })[]>();
  for (const method of methods) {
    const relative = method.path.replace(`ctx.${entry.family}.${entry.id}.`, "");
    const separator = relative.lastIndexOf(".");
    const group = separator < 0 ? "" : relative.slice(0, separator);
    const name = relative.slice(separator + 1);
    const items = groups.get(group) ?? [];
    items.push({ ...method, name });
    groups.set(group, items);
  }
  return [...groups].map(([name, methods]) => ({ name, methods }));
}
