import type {
  AgentSettingChange,
  AgentSettingDescriptor,
  AgentSettingOption,
  AgentSettingsOverrideSummary,
  AgentSettingsQuery,
  AgentSettingsSection,
  AgentSettingsSnapshot,
  AgentSettingsTarget,
} from "@read-aware/agent";
import {
  buildSettingDefinitions,
  validateSettingValue,
  type SettingDefinition,
  type SettingsDraft,
} from "./settings-catalog";

export type { SettingsDraft } from "./settings-catalog";

function definitionOptions(
  definition: SettingDefinition,
  draft: SettingsDraft,
): AgentSettingOption[] | undefined {
  if (!definition.options) return undefined;
  return typeof definition.options === "function"
    ? definition.options(draft)
    : definition.options;
}

function activeOverrides(
  draft: SettingsDraft,
  section?: AgentSettingsSection,
): AgentSettingsOverrideSummary[] {
  if (section && section !== "reading") return [];
  const paths = buildSettingDefinitions(draft)
    .filter((definition) => definition.section === "reading")
    .map((definition) => definition.path);
  return Object.entries(draft.readerOverrides)
    .filter(([, override]) => override.scope === "book")
    .map(([bookId]) => ({ target: { kind: "book" as const, bookId }, paths }));
}

export function settingsSnapshotFromDraft(
  draft: SettingsDraft,
  query: AgentSettingsQuery = {},
): AgentSettingsSnapshot {
  const target = query.target ?? { kind: "global" as const };
  if (target.kind === "book" && query.section && query.section !== "reading") {
    throw new Error("book targets are available only for reading settings");
  }
  const settings = buildSettingDefinitions(draft)
    .filter(
      (definition) => !query.section || definition.section === query.section,
    )
    .filter(
      (definition) =>
        target.kind === "global" ||
        definition.supportedTargets?.includes("book"),
    )
    .map<AgentSettingDescriptor>((definition) => {
      const options = definitionOptions(definition, draft);
      return {
        path: definition.path,
        section: definition.section,
        label: definition.label,
        ...(definition.description
          ? { description: definition.description }
          : {}),
        kind: definition.kind,
        value: definition.read(draft, target),
        writable: Boolean(definition.write),
        ...(definition.nullable ? { nullable: true } : {}),
        ...(options ? { options } : {}),
        ...(definition.write && definition.supportedTargets
          ? { supportedTargets: definition.supportedTargets }
          : {}),
      };
    });
  return { target, settings, overrides: activeOverrides(draft, query.section) };
}

function cloneDraft(draft: SettingsDraft): SettingsDraft {
  return {
    general: { ...draft.general },
    appearance: { ...draft.appearance },
    reading: { ...draft.reading },
    readerOverrides: Object.fromEntries(
      Object.entries(draft.readerOverrides).map(([bookId, override]) => [
        bookId,
        { ...override, settings: { ...override.settings } },
      ]),
    ),
    aiPreferences: {
      ...draft.aiPreferences,
      features: { ...draft.aiPreferences.features },
    },
    aiConfig: draft.aiConfig ? { ...draft.aiConfig } : null,
    pluginThemes: draft.pluginThemes,
    pluginFonts: draft.pluginFonts,
    menus: {
      config: Object.fromEntries(
        Object.entries(draft.menus.config).map(([surface, layout]) => [
          surface,
          { visible: [...layout.visible], overflow: [...layout.overflow] },
        ]),
      ) as SettingsDraft["menus"]["config"],
      plugins: draft.menus.plugins,
    },
    pluginSettings: {
      declared: draft.pluginSettings.declared,
      values: Object.fromEntries(
        Object.entries(draft.pluginSettings.values).map(([id, values]) => [
          id,
          { ...values },
        ]),
      ),
    },
  };
}

function mutableFingerprint(draft: SettingsDraft): string {
  const aiConfig = draft.aiConfig
    ? { ...draft.aiConfig, apiKey: draft.aiConfig.apiKey ? "configured" : "" }
    : null;
  return JSON.stringify({
    general: draft.general,
    appearance: draft.appearance,
    reading: draft.reading,
    readerOverrides: draft.readerOverrides,
    aiPreferences: draft.aiPreferences,
    aiConfig,
    menuConfig: draft.menus.config,
    pluginSettings: draft.pluginSettings.values,
  });
}

function targetKey(target: AgentSettingsTarget): string {
  return target.kind === "book" ? `book:${target.bookId}` : target.kind;
}

export function applySettingChangesToDraft(
  source: SettingsDraft,
  changes: AgentSettingChange[],
): { draft: SettingsDraft; changed: AgentSettingChange[] } {
  if (changes.length === 0) {
    throw new Error("at least one settings change is required");
  }
  const draft = cloneDraft(source);
  const definitions = new Map(
    buildSettingDefinitions(draft).map((entry) => [entry.path, entry]),
  );
  const seen = new Set<string>();
  const changed: AgentSettingChange[] = [];

  for (const change of changes) {
    const definition = definitions.get(change.path);
    if (!definition?.write || !definition.supportedTargets) {
      throw new Error(`unknown or read-only setting: ${change.path}`);
    }
    if (!change.target && definition.supportedTargets.length > 1) {
      throw new Error(
        `${change.path} requires an explicit target: ${definition.supportedTargets.join(", ")}`,
      );
    }
    const requestedTarget = change.target ?? { kind: "global" as const };
    const target: AgentSettingsTarget =
      requestedTarget.kind === "book"
        ? { kind: "book", bookId: requestedTarget.bookId.trim() }
        : requestedTarget;
    if (!definition.supportedTargets.includes(target.kind)) {
      throw new Error(`${change.path} does not support target ${target.kind}`);
    }
    if (target.kind === "book" && !target.bookId) {
      throw new Error("book target requires bookId");
    }
    const dedupeKey = `${change.path}@${targetKey(target)}`;
    if (seen.has(dedupeKey)) {
      throw new Error(`duplicate settings change: ${dedupeKey}`);
    }
    seen.add(dedupeKey);

    const value = validateSettingValue(definition, change.value, draft);
    const before = mutableFingerprint(draft);
    definition.write(draft, value, target);
    if (mutableFingerprint(draft) !== before) {
      changed.push({ path: change.path, value, target });
    }
  }

  return { draft, changed };
}
