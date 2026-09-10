import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { AppError, type Id, type ReadingSettingsReset, type SettingsOptionsQuery } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import type {
  AgentSettingChange,
  AgentSettingsQueryTarget,
  AgentSettingsQuery,
  AgentSettingsTarget,
  AgentSettingsUpdateResult,
} from "../settings";
import type { ThreadScope } from "../thread-scope";
import { textResult } from "./tool-result";
import { buildModelCatalogTools } from "./model-catalog-tools";

const sectionSchema = Type.Union([
  Type.Literal("general", { description: "General application behavior" }),
  Type.Literal("appearance", { description: "Application appearance and chat/note content typography, not reader pages" }),
  Type.Literal("reading", { description: "Reader pages: theme, font, and reading mode" }),
  Type.Literal("annotations", { description: "Preferences for new highlights and underlines" }),
  Type.Literal("shelf", { description: "Device-local shelf layout, grouping and sort order, not book data or selection" }),
  Type.Literal("shortcuts", { description: "Current keyboard bindings, registered defaults, overrides and conflicting paths" }),
  Type.Literal("ai", { description: "Non-sensitive AI behavior preferences" }),
  Type.Literal("menus", {
    description:
      "User-arranged menu surfaces (primary navigation, header bars, selection menu): ordered visible/overflow item lists",
  }),
  Type.Literal("plugins", {
    description:
      "Settings declared by enabled plugins, path form plugins.<pluginId>.<field>",
  }),
]);

const globalTargetSchema = Type.Object(
  { kind: Type.Literal("global") },
  { additionalProperties: false },
);

function bookTargetSchema(scope: ThreadScope) {
  return Type.Object(
    {
      kind: Type.Literal("book"),
      bookId:
        scope.kind === "book"
          ? Type.Optional(
              Type.String({
                minLength: 1,
                description: "Defaults to the current book in an in-book agent",
              }),
            )
          : Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  );
}

function queryTargetSchema(scope: ThreadScope) {
  return Type.Union([globalTargetSchema, bookTargetSchema(scope)]);
}

function writeTargetSchema(scope: ThreadScope) {
  return Type.Union([
    globalTargetSchema,
    bookTargetSchema(scope),
    Type.Object(
      { kind: Type.Literal("all-books") },
      { additionalProperties: false },
    ),
  ]);
}

const settingValueSchema = Type.Union([
  Type.Null(),
  Type.Boolean(),
  Type.Number(),
  Type.String(),
  // Ordered id lists (kind=id-list paths, e.g. menu surface layouts).
  Type.Array(Type.String({ minLength: 1 }), { maxItems: 64 }),
]);

function settingChangeSchema(scope: ThreadScope) {
  return Type.Object(
    {
      path: Type.String({
        minLength: 3,
        description: "An exact writable path returned by get_settings.",
      }),
      value: settingValueSchema,
      target: Type.Optional(writeTargetSchema(scope)),
    },
    { additionalProperties: false },
  );
}

async function normalizeTarget(
  deps: RuntimeDeps,
  scope: ThreadScope,
  target: { kind: string; bookId?: string } | undefined,
): Promise<AgentSettingsTarget | undefined> {
  if (!target) return undefined;
  if (target.kind !== "book") return target as AgentSettingsTarget;
  const bookId = target.bookId?.trim() || (scope.kind === "book" ? String(scope.bookId) : "");
  if (!bookId) throw new Error("book target requires bookId");
  if (!(await deps.library.getBook(bookId as Id))) {
    throw new Error(`unknown book: ${bookId}`);
  }
  return { kind: "book", bookId };
}

function shadowWarnings(result: AgentSettingsUpdateResult) {
  return result.changed.flatMap((change) => {
    if (change.target?.kind !== "global") return [];
    const bookIds = result.settings.overrides
      .filter((override) => override.paths.includes(change.path))
      .map((override) => override.target.bookId);
    return bookIds.length > 0
      ? [
          {
            path: change.path,
            message:
              "The global value changed, but book overrides still take precedence.",
            shadowedBy: bookIds.map((bookId) => ({ kind: "book", bookId })),
          },
        ]
      : [];
  });
}

export function buildSettingsTools(scope: ThreadScope, deps: RuntimeDeps): AgentTool[] {
  const getSettingOptions: AgentTool = {
    name: "get_setting_options",
    label: "Find setting options",
    description: "Search and page through one exact setting's available options without reading its current value. reading.fontFamily and appearance.contentTypography.fontFamily include installed system fonts as well as curated and enabled plugin fonts. Copy the returned value into update_settings; do not invent family names. This lists names, not font files or render readiness, and does not download fonts. Retain the same path/search/target and revision for later pages; restart at offset zero if stale. Installing system fonts requires restarting the app to refresh its session cache.",
    parameters: Type.Object({
      path: Type.String({ minLength: 1, maxLength: 256 }),
      search: Type.Optional(Type.String({ maxLength: 120 })),
      offset: Type.Optional(Type.Integer({ minimum: 0 })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
      revision: Type.Optional(Type.Integer({ minimum: 0 })),
      target: Type.Optional(queryTargetSchema(scope)),
    }, { additionalProperties: false }),
    execute: async (_id, params, signal) => {
      const query = structuredClone(params) as SettingsOptionsQuery;
      signal?.throwIfAborted();
      if (query.limit !== undefined && (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 50)) {
        throw new AppError("settings/options-invalid", "Choose at most 50 options per page");
      }
      const target = await normalizeTarget(deps, scope, query.target) as AgentSettingsQueryTarget | undefined;
      const result = await deps.settings.getSettingOptions({ ...query, target, limit: query.limit ?? 20 });
      signal?.throwIfAborted();
      return textResult(result);
    },
  };
  const getSettings: AgentTool = {
    name: "get_settings",
    label: "Read settings",
    description:
      "Read the host's current non-sensitive settings catalog. Each entry provides an exact path, current value, value kind, valid options, writability, and supportedTargets. Use get_setting_options to search larger option lists or installed system fonts; those fonts are not included in this compact snapshot. Reader page theme/font/mode live in section=reading; section=appearance is application appearance and chat/note content typography. section=annotations includes the default color for new marks, not edits to existing annotations. Use target=book to inspect one book; inside a book agent its bookId defaults to the current book. overrides reports scoped values that shadow global defaults. API keys and Custom endpoint values are never exposed.",
    parameters: Type.Object(
      {
        section: Type.Optional(sectionSchema),
        target: Type.Optional(queryTargetSchema(scope)),
      },
      { additionalProperties: false },
    ),
    execute: async (_id, params) => {
      const raw = params as Omit<AgentSettingsQuery, "target"> & {
        target?: { kind: string; bookId?: string };
      };
      const target = (await normalizeTarget(
        deps,
        scope,
        raw.target,
      )) as AgentSettingsQueryTarget | undefined;
      const query: AgentSettingsQuery = { section: raw.section, target };
      return textResult({ settings: await deps.settings.getSettings(query) });
    },
  };

  const updateSettings: AgentTool = {
    name: "update_settings",
    label: "Update settings",
    description:
      "Update ordinary settings only when the user explicitly asks. Always call get_settings first, then copy exact writable paths and values/options from its catalog. Never invent paths. For kind=id-list (menus), write the COMPLETE ordered array using available options. For kind=key-chord (shortcuts), write optional mod/alt/shift tokens followed by one KeyboardEvent.key, e.g. [mod,shift,k]; null restores the registered default, not unbind. Read shortcut metadata for defaults, overrides, availability and conflicts; swap conflicting bindings in ONE batch. A setting with multiple supportedTargets requires an explicit target; call ask_user when scope is ambiguous. Global-only settings may omit target. Global changes may be shadowed by book overrides. This tool cannot access API keys, Custom endpoint destinations, destructive data actions or plugin lifecycle.",
    parameters: Type.Object(
      {
        changes: Type.Array(settingChangeSchema(scope), { minItems: 1, maxItems: 50 }),
      },
      { additionalProperties: false },
    ),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const { changes: rawChanges } = params as {
        changes: Array<Omit<AgentSettingChange, "target"> & {
          target?: { kind: string; bookId?: string };
        }>;
      };
      if (!Array.isArray(rawChanges) || rawChanges.length === 0) {
        throw new Error("at least one settings change is required");
      }
      const changes: AgentSettingChange[] = await Promise.all(
        rawChanges.map(async (change) => ({
          path: change.path,
          value: change.value,
          target: await normalizeTarget(deps, scope, change.target),
        })),
      );
      const result = await deps.settings.updateSettings(changes);
      const warnings = shadowWarnings(result);
      return textResult({
        updated: result.changed.length > 0,
        ...result,
        ...(warnings.length > 0 ? { warnings } : {}),
      });
    },
  };

  const resetReading: AgentTool = {
    name: "reset_reading_settings", label: "Reset reading appearance", executionMode: "sequential",
    description: "Only on explicit user request, reset the WHOLE reader-preference bundle after reading get_settings. target is required; ask_user if scope is ambiguous. action=defaults with global restores built-in global preferences but retains book overrides; with book stores built-in defaults as that book's active override; with all-books resets global and deletes all active/remembered overrides. action=inherit with book deletes its override and follows future global changes; with all-books deletes every override without changing global values. inherit is invalid for global. Equal values are not the same as removing an override. get_settings reading metadata exposes source, active/inactive/absent override and built-in defaultValue. This does not reset general/AI/plugin preferences, positions or book data. Cancellation before persistence prevents the reset; dispatched writes are not rolled back by later cancellation.",
    parameters: Type.Object({ action: Type.Union([Type.Literal("defaults"), Type.Literal("inherit")]), target: writeTargetSchema(scope) }, { additionalProperties: false }),
    execute: async (_id, params, signal) => {
      const accepted = structuredClone(params) as { action: "defaults" | "inherit"; target?: { kind: string; bookId?: string } };
      signal?.throwIfAborted();
      const target = await normalizeTarget(deps, scope, accepted.target);
      if (!target || !["defaults", "inherit"].includes(accepted.action) || (accepted.action === "inherit" && target.kind === "global")) {
        throw new AppError("ui/invalid-target", "Choose an explicit valid reading reset scope");
      }
      signal?.throwIfAborted();
      return textResult(await deps.settings.resetReading({ action: accepted.action, target } as ReadingSettingsReset, signal));
    },
  };
  return [getSettings, getSettingOptions, updateSettings, resetReading, ...buildModelCatalogTools(deps)];
}
