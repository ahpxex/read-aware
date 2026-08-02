import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { Id } from "@read-aware/core";
import type { RuntimeDeps } from "../ports";
import type {
  AgentSettingChange,
  AgentSettingsQuery,
  AgentSettingsUpdateResult,
} from "../settings";
import { textResult } from "./tool-result";

const sectionSchema = Type.Union([
  Type.Literal("general"),
  Type.Literal("appearance"),
  Type.Literal("reading"),
  Type.Literal("ai"),
]);

const globalTargetSchema = Type.Object(
  { kind: Type.Literal("global") },
  { additionalProperties: false },
);

const bookTargetSchema = Type.Object(
  {
    kind: Type.Literal("book"),
    bookId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

const queryTargetSchema = Type.Union([globalTargetSchema, bookTargetSchema]);

const writeTargetSchema = Type.Union([
  globalTargetSchema,
  bookTargetSchema,
  Type.Object(
    { kind: Type.Literal("all-books") },
    { additionalProperties: false },
  ),
]);

const settingValueSchema = Type.Union([
  Type.Null(),
  Type.Boolean(),
  Type.Number(),
  Type.String(),
]);

const settingChangeSchema = Type.Object(
  {
    path: Type.String({
      minLength: 3,
      pattern: "^[a-z][a-zA-Z0-9-]*(?:\\.[a-z][a-zA-Z0-9-]*)+$",
      description: "An exact writable path returned by get_settings.",
    }),
    value: settingValueSchema,
    target: Type.Optional(writeTargetSchema),
  },
  { additionalProperties: false },
);

async function assertKnownBookTarget(
  deps: RuntimeDeps,
  target: { kind: string; bookId?: string } | undefined,
): Promise<void> {
  if (target?.kind !== "book") return;
  const bookId = target.bookId?.trim();
  if (!bookId) throw new Error("book target requires bookId");
  if (!(await deps.library.getBook(bookId as Id))) {
    throw new Error(`unknown book: ${bookId}`);
  }
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

export function buildSettingsTools(deps: RuntimeDeps): AgentTool[] {
  const getSettings: AgentTool = {
    name: "get_settings",
    label: "Read settings",
    description:
      "Read the host's current non-sensitive settings catalog. Each entry provides an exact path, current value, value kind, valid options, writability, and supportedTargets. Use target=book to inspect the effective settings for one book. overrides reports scoped values that shadow global defaults. API keys and Custom endpoint values are never exposed.",
    parameters: Type.Object(
      {
        section: Type.Optional(sectionSchema),
        target: Type.Optional(queryTargetSchema),
      },
      { additionalProperties: false },
    ),
    execute: async (_id, params) => {
      const query = params as AgentSettingsQuery;
      await assertKnownBookTarget(deps, query.target);
      return textResult({ settings: await deps.settings.getSettings(query) });
    },
  };

  const updateSettings: AgentTool = {
    name: "update_settings",
    label: "Update settings",
    description:
      "Update ordinary settings only when the user explicitly asks. Always call get_settings first, then copy exact writable paths and values/options from its catalog. Changes are generic path/value operations: never invent a path or option. A setting with multiple supportedTargets requires an explicit target; call ask_user when the intended scope is ambiguous. Global-only settings may omit target. A successful global write can still report warnings when book overrides take precedence. This tool cannot access API keys, Custom endpoint destinations, destructive data actions, plugin lifecycle, menus, or shortcuts.",
    parameters: Type.Object(
      {
        changes: Type.Array(settingChangeSchema, { minItems: 1, maxItems: 50 }),
      },
      { additionalProperties: false },
    ),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const { changes } = params as { changes: AgentSettingChange[] };
      if (!Array.isArray(changes) || changes.length === 0) {
        throw new Error("at least one settings change is required");
      }
      for (const change of changes) {
        await assertKnownBookTarget(deps, change.target);
      }
      const result = await deps.settings.updateSettings(changes);
      const warnings = shadowWarnings(result);
      return textResult({
        updated: result.changed.length > 0,
        ...result,
        ...(warnings.length > 0 ? { warnings } : {}),
      });
    },
  };

  return [getSettings, updateSettings];
}
