import { AppError } from "./errors";

export const HOST_SHELF_LAYOUTS = ["grid", "list"] as const;
export const HOST_SHELF_SORTS = ["recent", "added", "title", "author", "progress"] as const;
export const HOST_SHELF_GROUPS = ["none", "status", "author", "format"] as const;
export const HOST_COMMAND_IDS = [
  "go-shelf", "go-context", "go-stats", "open-settings", "select",
  "layout-grid", "layout-list", "sort-recent", "sort-added", "sort-title", "sort-author", "sort-progress",
  "group-none", "group-status", "group-author", "group-format",
] as const;
export type HostCommandId = typeof HOST_COMMAND_IDS[number];
export type HostCommandRequest = { id: HostCommandId; expectedWorkspaceRevision?: number };
export type HostCommandDescriptor = {
  id: HostCommandId;
  title: string;
  enabled: boolean;
  checked?: boolean;
  unavailableReason?: "permission" | "workspace" | "reader-control";
  settingsPath?: string;
  /** Commands are parameterless; revision is a guard, never a menu argument. */
  parameters: { type: "object"; properties: Record<string, never>; additionalProperties: false };
};
export type HostCommandSnapshot = { version: 1; workspaceRevision: number | null; commands: HostCommandDescriptor[] };
export type HostCommandReceipt = {
  commandId: HostCommandId;
  status: "completed" | "partial";
  completed: ("settings" | "workspace")[];
  errorCode?: string;
};

export function normalizeHostCommandRequest(value: unknown): HostCommandRequest {
  const invalid = (): never => { throw new AppError("ui/invalid-target", "Invalid host command request"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => key !== "id" && key !== "expectedWorkspaceRevision")) return invalid();
  if (!(HOST_COMMAND_IDS as readonly unknown[]).includes(input.id)) return invalid();
  const revision = input.expectedWorkspaceRevision;
  if (revision !== undefined && (!Number.isSafeInteger(revision) || (revision as number) < 0)) return invalid();
  return { id: input.id as HostCommandId, ...(revision === undefined ? {} : { expectedWorkspaceRevision: revision as number }) };
}
