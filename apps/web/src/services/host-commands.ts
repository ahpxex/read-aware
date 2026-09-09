import { AppError, errorCode, HOST_COMMAND_IDS, hostCommandParameters, normalizeHostCommandRequest, type HostCommandId, type HostCommandRequest, type HostCommandReceipt, type HostCommandSnapshot, type WorkspaceTarget, type WorkspaceSnapshot } from "@read-aware/core";
import type { SettingsDomain } from "../domain/settings/domain";
import type { WorkspaceService } from "./workspace";

type Dependencies = {
  workspace: Pick<WorkspaceService, "snapshot" | "navigate">;
  settings: { queries: Pick<SettingsDomain["queries"], "snapshot">; commands: Pick<SettingsDomain["commands"], "update"> };
  canReadWorkspace: boolean;
  canNavigate: boolean;
  canCloseReader: boolean;
  openBook(bookId: string, signal?: AbortSignal): Promise<unknown>;
  title(id: HostCommandId): string;
};
const setting = (id: HostCommandId) => id.startsWith("layout-") ? { path: "shelf.layout", value: id.slice(7) }
  : id.startsWith("sort-") ? { path: "shelf.sort", value: id.slice(5) }
    : id.startsWith("group-") ? { path: "shelf.group", value: id.slice(6) } : undefined;
function target(request: HostCommandRequest, state: WorkspaceSnapshot): WorkspaceTarget {
  const { id } = request;
  if (request.id === "open-collection") return { surface: "shelf", collectionId: request.args.collectionId };
  if (id === "go-context") return { surface: "agent" };
  if (id === "go-stats") return { surface: "stats" };
  if (id === "open-settings") return { surface: "settings", section: state.settings.section ?? "general" };
  if (setting(id)) return { surface: "shelf", collectionId: state.collectionId,
    selection: { active: state.selection.active, bookIds: state.selection.bookIds } };
  return { surface: "shelf", collectionId: null, ...(id === "select" ? { selection: { active: true, bookIds: [] } } : {}) };
}

/** A finite catalog over existing semantic operations, never arbitrary UI callbacks or plugin RPC. */
export function createHostCommands(deps: Dependencies) {
  const list = async (signal?: AbortSignal): Promise<HostCommandSnapshot> => {
    signal?.throwIfAborted();
    const settings = await deps.settings.queries.snapshot({ section: "shelf" });
    signal?.throwIfAborted();
    let state: ReturnType<WorkspaceService["snapshot"]> | undefined;
    if (deps.canReadWorkspace) {
      try { state = deps.workspace.snapshot({ limit: 1 }); }
      catch (error) { if (errorCode(error) !== "ui/unavailable") throw error; }
    }
    return { version: 1, workspaceRevision: state?.revision ?? null, commands: HOST_COMMAND_IDS.map(id => {
      const change = setting(id), descriptor = settings.settings.find(item => item.path === change?.path);
      const unavailableReason = !deps.canNavigate || (change && !descriptor?.writable) ? "permission" as const
        : !state ? "workspace" as const
          : (id === "open-book" || state.surface === "reader" && id !== "open-settings") && !deps.canCloseReader ? "reader-control" as const : undefined;
      return { id, title: deps.title(id), enabled: !unavailableReason, ...(unavailableReason ? { unavailableReason } : {}),
        ...(change ? { settingsPath: change.path, ...(descriptor ? { checked: descriptor.value === change.value } : {}) } : {}),
        parameters: hostCommandParameters(id) };
    }) };
  };
  const execute = async (input: unknown, signal?: AbortSignal): Promise<HostCommandReceipt> => {
    signal?.throwIfAborted();
    const accepted = normalizeHostCommandRequest(input);
    const snapshot = await list(signal);
    const command = snapshot.commands.find(item => item.id === accepted.id)!;
    if (!command.enabled) throw new AppError("ui/unavailable", `Host command unavailable: ${command.unavailableReason}`);
    if (accepted.expectedWorkspaceRevision !== undefined && accepted.expectedWorkspaceRevision !== snapshot.workspaceRevision) {
      throw new AppError("ui/superseded", "Workspace changed since command discovery");
    }
    const completed: HostCommandReceipt["completed"] = [];
    const change = setting(accepted.id);
    const state = deps.workspace.snapshot({ limit: 1000 });
    if (state.revision !== snapshot.workspaceRevision) throw new AppError("ui/superseded", "Workspace changed during command validation");
    if (accepted.id === "open-book") {
      await deps.openBook(accepted.args.bookId, signal);
      return { commandId: accepted.id, status: "completed", completed: ["reading"] };
    }
    if (change && state.selection.total > state.selection.bookIds.length) throw new AppError("ui/unavailable", "Selection exceeds the workspace navigation limit");
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
  return { list, execute };
}
