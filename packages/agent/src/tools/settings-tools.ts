import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { Id } from "@read-aware/core";
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

const sectionSchema = Type.Union([
  Type.Literal("general", { description: "General application behavior" }),
  Type.Literal("appearance", { description: "Application shell appearance, not reader pages" }),
  Type.Literal("reading", { description: "Reader pages: theme, font, and reading mode" }),
  Type.Literal("ai", { description: "Non-sensitive AI behavior preferences" }),
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
]);

function settingChangeSchema(scope: ThreadScope) {
  return Type.Object(
    {
      path: Type.String({
        minLength: 3,
        pattern: "^[a-z][a-zA-Z0-9-]*(?:\\.[a-z][a-zA-Z0-9-]*)+$",
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
  const getSettings: AgentTool = {
    name: "get_settings",
    label: "Read settings",
    description:
      "Read the host's current non-sensitive settings catalog. Each entry provides an exact path, current value, value kind, valid options, writability, and supportedTargets. Reader page theme/font/mode live in section=reading; section=appearance is the application shell. Use target=book to inspect one book; inside a book agent its bookId defaults to the current book. overrides reports scoped values that shadow global defaults. API keys and Custom endpoint values are never exposed.",
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
      "Update ordinary settings only when the user explicitly asks. Always call get_settings first, then copy exact writable paths and values/options from its catalog. Changes are generic path/value operations: never invent a path or option. A setting with multiple supportedTargets requires an explicit target; call ask_user when the intended scope is ambiguous. Global-only settings may omit target. A successful global write can still report warnings when book overrides take precedence. This tool cannot access API keys, Custom endpoint destinations, destructive data actions, plugin lifecycle, menus, or shortcuts.",
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

  return [getSettings, updateSettings];
}
