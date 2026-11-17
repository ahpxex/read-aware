import { createLogger } from "../platform/logger";
import {
  AppError,
  errorCode,
  operationAvailability,
  type OperationAvailability,
  type OperationCondition,
  HOST_COMMAND_IDS,
  hostCommandParameters,
  normalizeHostCommandRequest,
  type HostCommandId,
  type HostCommandRequest,
  type HostCommandReceipt,
  type HostCommandSnapshot,
  type WorkspaceTarget,
  type WorkspaceSnapshot,
} from "@read-aware/core";
import type { SettingsDomain } from "../domain/settings/domain";
import type { WorkspaceService } from "./workspace";

const log = createLogger("host-commands");
class CommandConditionError extends AppError {
  constructor(readonly condition: OperationCondition) {
    super(condition.errorCode ?? "ui/unavailable", condition.reason);
  }
}
const unavailable = (kind: OperationCondition["kind"], reason: string, errorCode = "ui/unavailable"): never => {
  throw new CommandConditionError({ kind, state: "unavailable", reason, errorCode });
};

type Dependencies = {
  workspace: Pick<WorkspaceService, "snapshot" | "navigate">;
  settings: {
    queries: Pick<SettingsDomain["queries"], "snapshot">;
    commands: Pick<SettingsDomain["commands"], "update">;
  };
  canReadWorkspace: boolean;
  canNavigate: boolean;
  canCloseReader: boolean;
  openBook(bookId: string, signal?: AbortSignal): Promise<unknown>;
  title(id: HostCommandId): string;
};
const setting = (id: HostCommandId) =>
  id.startsWith("layout-")
    ? { path: "shelf.layout", value: id.slice(7) }
    : id.startsWith("sort-")
      ? { path: "shelf.sort", value: id.slice(5) }
      : id.startsWith("group-")
        ? { path: "shelf.group", value: id.slice(6) }
        : undefined;
/** The pages a parameterless command opens. `go-shelf` lands on the shelf's
 *  root with nothing selected (see `target`). */
const PAGE_COMMANDS = {
  "go-shelf": "shelf",
  "go-context": "agent",
  "go-stats": "stats",
} as const satisfies Partial<Record<HostCommandId, WorkspaceTarget["surface"]>>;
type PageCommand = keyof typeof PAGE_COMMANDS;

/** The command that opens `surface`, when the catalog has one — the native
 *  palette runs it so its "Go to" items share the Agent's semantics. */
export function hostCommandForPage(surface: string): PageCommand | undefined {
  return (Object.keys(PAGE_COMMANDS) as PageCommand[]).find((id) => PAGE_COMMANDS[id] === surface);
}

function target(request: HostCommandRequest, state: WorkspaceSnapshot): WorkspaceTarget {
  const { id } = request;
  if (request.id === "open-collection") return { surface: "shelf", collectionId: request.args.collectionId };
  if (id === "go-context" || id === "go-stats") return { surface: PAGE_COMMANDS[id] };
  if (id === "open-settings") return { surface: "settings", section: state.settings.section ?? "general" };
  if (setting(id))
    return {
      surface: "shelf",
      collectionId: state.collectionId,
      selection: { active: state.selection.active, bookIds: state.selection.bookIds },
    };
  return {
    surface: "shelf",
    collectionId: null,
    ...(id === "select" ? { selection: { active: true, bookIds: [] } } : {}),
  };
}

/** A finite catalog over existing semantic operations, never arbitrary UI callbacks or plugin RPC. */
export function createHostCommands(deps: Dependencies) {
  const list = async (signal?: AbortSignal): Promise<HostCommandSnapshot> => {
    signal?.throwIfAborted();
    const settings = await deps.settings.queries.snapshot({ section: "shelf" });
    signal?.throwIfAborted();
    let state: ReturnType<WorkspaceService["snapshot"]> | undefined;
    if (deps.canReadWorkspace) {
      try {
        state = deps.workspace.snapshot({ limit: 1 });
      } catch (error) {
        if (errorCode(error) !== "ui/unavailable") throw error;
      }
    }
    return {
      version: 1,
      workspaceRevision: state?.revision ?? null,
      commands: HOST_COMMAND_IDS.map((id) => {
        const change = setting(id),
          descriptor = settings.settings.find((item) => item.path === change?.path);
        const unavailableReason =
          !deps.canNavigate || (change && !descriptor?.writable)
            ? ("permission" as const)
            : !state
              ? ("workspace" as const)
              : (id === "open-book" || (state.surface === "reader" && id !== "open-settings")) && !deps.canCloseReader
                ? ("reader-control" as const)
                : undefined;
        return {
          id,
          title: deps.title(id),
          enabled: !unavailableReason,
          ...(unavailableReason ? { unavailableReason } : {}),
          ...(change
            ? { settingsPath: change.path, ...(descriptor ? { checked: descriptor.value === change.value } : {}) }
            : {}),
          parameters: hostCommandParameters(id),
        };
      }),
    };
  };
  const prepare = async (input: unknown, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    const accepted = normalizeHostCommandRequest(input);
    const snapshot = await list(signal);
    const command = snapshot.commands.find((item) => item.id === accepted.id)!;
    if (!command.enabled)
      unavailable(
        command.unavailableReason === "permission" || command.unavailableReason === "reader-control"
          ? "permission"
          : "provider",
        `command-${command.unavailableReason}`,
      );
    if (
      accepted.expectedWorkspaceRevision !== undefined &&
      accepted.expectedWorkspaceRevision !== snapshot.workspaceRevision
    ) {
      unavailable("object", "workspace-revision-changed", "ui/superseded");
    }
    const change = setting(accepted.id);
    const state = deps.workspace.snapshot({ limit: 1000 });
    if (state.revision !== snapshot.workspaceRevision)
      unavailable("object", "workspace-revision-changed", "ui/superseded");
    if (change && state.selection.total > state.selection.bookIds.length)
      unavailable("capacity", "workspace-selection-limit");
    return { accepted, snapshot, state, change };
  };
  const check = async (input: unknown, signal?: AbortSignal): Promise<OperationAvailability> => {
    const command = normalizeHostCommandRequest(input);
    const query = { operation: "ui.commands.execute" as const, command };
    try {
      await prepare(command, signal);
      signal?.throwIfAborted();
      return operationAvailability(query, [
        { kind: "permission", state: "satisfied", reason: "command-authorized" },
        { kind: "object", state: "satisfied", reason: "workspace-revision-current" },
        { kind: "provider", state: "unknown", reason: "command-target-and-commit-not-probed" },
      ]);
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof CommandConditionError) return operationAvailability(query, [error.condition]);
      log.warn("Cannot inspect command prerequisites", error);
      return operationAvailability(query, [
        {
          kind: "provider",
          state: "unknown",
          reason: "command-prerequisites-read-failed",
          errorCode: errorCode(error) ?? "internal",
        },
      ]);
    }
  };
  const execute = async (input: unknown, signal?: AbortSignal): Promise<HostCommandReceipt> => {
    const { accepted, snapshot, state, change } = await prepare(input, signal);
    signal?.throwIfAborted();
    if (deps.workspace.snapshot({ limit: 1 }).revision !== snapshot.workspaceRevision)
      unavailable("object", "workspace-revision-changed", "ui/superseded");
    const completed: HostCommandReceipt["completed"] = [];
    if (accepted.id === "open-book") {
      await deps.openBook(accepted.args.bookId, signal);
      return { commandId: accepted.id, status: "completed", completed: ["reading"] };
    }
    if (change) {
      await deps.settings.commands.update([change], signal);
      completed.push("settings");
    }
    try {
      signal?.throwIfAborted();
      await deps.workspace.navigate(target(accepted, state), snapshot.workspaceRevision!, signal, deps.canCloseReader);
      completed.push("workspace");
      return { commandId: accepted.id, status: "completed", completed };
    } catch (error) {
      if (!completed.length) throw error;
      return { commandId: accepted.id, status: "partial", completed, errorCode: errorCode(error) ?? "ui/unavailable" };
    }
  };
  return { list, check, execute };
}
