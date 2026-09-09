import { AppError } from "./errors";

export const HOST_SHELF_LAYOUTS = ["grid", "list"] as const;
export const HOST_SHELF_SORTS = ["recent", "added", "title", "author", "progress"] as const;
export const HOST_SHELF_GROUPS = ["none", "status", "author", "format"] as const;
export const PARAMETERLESS_HOST_COMMAND_IDS = [
  "go-shelf", "go-context", "go-stats", "open-settings", "select",
  "layout-grid", "layout-list", "sort-recent", "sort-added", "sort-title", "sort-author", "sort-progress",
  "group-none", "group-status", "group-author", "group-format",
] as const;
export const HOST_COMMAND_IDS = [...PARAMETERLESS_HOST_COMMAND_IDS, "open-book", "open-collection"] as const;
export type HostCommandId = typeof HOST_COMMAND_IDS[number];
export type HostCommandRequest = (
  | { id: typeof PARAMETERLESS_HOST_COMMAND_IDS[number]; args?: never }
  | { id: "open-book"; args: { bookId: string } }
  | { id: "open-collection"; args: { collectionId: string } }
) & { expectedWorkspaceRevision?: number };
export type HostCommandDescriptor = {
  id: HostCommandId;
  title: string;
  enabled: boolean;
  checked?: boolean;
  unavailableReason?: "permission" | "workspace" | "reader-control";
  settingsPath?: string;
  /** Parameters are semantic resource IDs, never rendered menu IDs or labels. */
  parameters: { type: "object"; properties: Record<string, { type: "string"; minLength: number; maxLength: number }>; required?: string[]; additionalProperties: false };
};
export type HostCommandSnapshot = { version: 1; workspaceRevision: number | null; commands: HostCommandDescriptor[] };
export type HostCommandReceipt = {
  commandId: HostCommandId;
  status: "completed" | "partial";
  completed: ("settings" | "workspace" | "reading")[];
  errorCode?: string;
};

export function normalizeHostCommandRequest(value: unknown): HostCommandRequest {
  const invalid = (): never => { throw new AppError("ui/invalid-target", "Invalid host command request"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => key !== "id" && key !== "expectedWorkspaceRevision" && key !== "args")) return invalid();
  if (!(HOST_COMMAND_IDS as readonly unknown[]).includes(input.id)) return invalid();
  const revision = input.expectedWorkspaceRevision;
  if (revision !== undefined && (!Number.isSafeInteger(revision) || (revision as number) < 0)) return invalid();
  const guard = revision === undefined ? {} : { expectedWorkspaceRevision: revision as number };
  if (input.id === "open-book" || input.id === "open-collection") {
    if (!input.args || typeof input.args !== "object" || Array.isArray(input.args)) return invalid();
    const args = input.args as Record<string, unknown>, key = input.id === "open-book" ? "bookId" : "collectionId", id = args[key];
    if (Object.keys(args).length !== 1 || typeof id !== "string" || !id.trim() || id.length > 256) return invalid();
    return input.id === "open-book" ? { id: input.id, args: { bookId: id }, ...guard }
      : { id: input.id, args: { collectionId: id }, ...guard };
  }
  if (input.args !== undefined) return invalid();
  return { id: input.id as typeof PARAMETERLESS_HOST_COMMAND_IDS[number], ...guard };
}

export function hostCommandParameters(id: HostCommandId): HostCommandDescriptor["parameters"] {
  const key = id === "open-book" ? "bookId" : id === "open-collection" ? "collectionId" : undefined;
  return { type: "object", properties: key ? { [key]: { type: "string", minLength: 1, maxLength: 256 } } : {},
    ...(key ? { required: [key] } : {}), additionalProperties: false };
}
