import { AppError } from "./errors";

export const WORKSPACE_SETTINGS_SECTIONS = ["general", "appearance", "reading", "ai", "plugins", "menus", "shortcuts", "dataSync", "about"] as const;
export type WorkspaceSettingsSection = (typeof WORKSPACE_SETTINGS_SECTIONS)[number] | `plugin:${string}`;
export type WorkspaceTarget =
  | { surface: "shelf"; collectionId?: string | null; selection?: { active: boolean; bookIds: string[] } }
  | { surface: "agent" | "stats" }
  | { surface: "settings"; section?: WorkspaceSettingsSection }
  | { surface: "search"; query?: string };
export type WorkspaceQuery = { selectionAfter?: string; limit?: number };
export type WorkspaceSnapshot = {
  revision: number;
  surface: "shelf" | "agent" | "stats" | "plugin" | "reader";
  collectionId: string | null;
  settings: { open: boolean; section: WorkspaceSettingsSection | null };
  search: { open: boolean; query: string };
  selection: { active: boolean; total: number; bookIds: string[]; nextCursor: string | null };
};
export type WorkspaceReceipt = { status: "completed"; snapshot: WorkspaceSnapshot };

const validId = (value: unknown): value is string => typeof value === "string" && !!value.trim() && value.length <= 256;
const invalid = (): never => { throw new AppError("ui/invalid-target", "Invalid workspace target or query"); };

export function normalizeWorkspaceQuery(input: WorkspaceQuery = {}): WorkspaceQuery & { limit: number } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return invalid();
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || (input.selectionAfter !== undefined && !validId(input.selectionAfter))) return invalid();
  return { limit, ...(input.selectionAfter !== undefined ? { selectionAfter: input.selectionAfter } : {}) };
}

export function normalizeWorkspaceTarget(input: WorkspaceTarget): WorkspaceTarget {
  if (!input || typeof input !== "object" || Array.isArray(input)) return invalid();
  switch (input.surface) {
    case "agent": case "stats": return { surface: input.surface };
    case "search":
      if (input.query !== undefined && (typeof input.query !== "string" || input.query.length > 4096)) return invalid();
      return { surface: "search", query: input.query ?? "" };
    case "settings": {
      const section = input.section ?? "general";
      if (!WORKSPACE_SETTINGS_SECTIONS.includes(section as typeof WORKSPACE_SETTINGS_SECTIONS[number])
        && !(typeof section === "string" && section.startsWith("plugin:") && validId(section.slice(7)))) return invalid();
      return { surface: "settings", section };
    }
    case "shelf": {
      if (input.collectionId !== undefined && input.collectionId !== null && !validId(input.collectionId)) return invalid();
      const selection = input.selection;
      if (selection !== undefined && (!selection || typeof selection !== "object" || typeof selection.active !== "boolean"
        || !Array.isArray(selection.bookIds) || selection.bookIds.length > 1000 || !selection.bookIds.every(validId)
        || (!selection.active && selection.bookIds.length > 0))) return invalid();
      return { surface: "shelf", collectionId: input.collectionId ?? null,
        ...(selection ? { selection: { active: selection.active, bookIds: [...new Set(selection.bookIds)] } } : {}) };
    }
    default: return invalid();
  }
}
