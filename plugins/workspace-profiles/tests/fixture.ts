import type { PluginContext, PluginDocumentChange, PluginToolDefinition } from "@read-aware/plugin-types";
import { PROFILE_PATHS } from "../src/profiles";

export function fixture() {
  type Change = Parameters<PluginContext["domains"]["settings"]["commands"]["update"]>[0][number];
  const documents = new Map<string, unknown>(), revisions = new Map<string, string>();
  const updates: Change[][] = [], commits: PluginDocumentChange[][] = [];
  const tools = new Map<string, PluginToolDefinition>();
  const registrations: string[] = [];
  let snapshots = 0, generation = 0, fail = false;
  const values: Record<string, unknown> = { "shelf.layout": "list", "shelf.group": "none", "shelf.sort": "title", "appearance.theme": "light",
    "appearance.motion": "full", "reading.fontSize": 20, "reading.lineSpacing": 1.5, "reading.fontFamily": null,
    "appearance.contentTypography.fontFamily": null, "appearance.contentTypography.followReader": true };
  const doc = (id: string) => ({ id, data: structuredClone(documents.get(id)), revision: revisions.get(id) ?? "initial", updatedAt: "2026-09-11T00:00:00Z" });
  const storage = {
    collection: () => ({ get: async (id: string) => documents.has(id) ? doc(id) : null,
      page: async ({ cursor, limit = 40 }: { cursor?: string; limit?: number }) => {
        const [version, offset] = cursor?.split(":").map(Number) ?? [generation, 0];
        if (version !== generation) return { status: "stale-cursor" };
        const all = [...documents.keys()], ids = all.slice(offset, offset! + limit);
        return { status: "ready", items: ids.map(doc), nextCursor: offset! + limit < all.length ? `${generation}:${offset! + limit}` : null };
      } }),
    applyDocuments: async (changes: PluginDocumentChange[]) => {
      if (fail) throw Error("write failed");
      commits.push(structuredClone(changes));
      for (const [index, change] of changes.entries()) {
        const revision = documents.has(change.id) ? revisions.get(change.id) ?? "initial" : null;
        if (revision !== change.expectedRevision) return { status: "conflict", index };
      }
      for (const change of changes) {
        if (change.kind === "put") documents.set(change.id, structuredClone(change.data));
        if (change.kind === "delete") documents.delete(change.id);
        revisions.set(change.id, String(++generation));
      }
      return { status: "applied", documents: changes.map(change => ({ collection: change.collection, id: change.id, revision: revisions.get(change.id) })) };
    },
  };
  const ctx = { locale: "en", domains: { settings: {
    queries: { snapshot: async () => {
      snapshots++;
      return { settings: PROFILE_PATHS.map(path => ({ path, value: values[path], writable: true })) };
    } },
    commands: { update: async (changes: Change[]) => {
      if (fail) throw Error("rejected stale option");
      updates.push(structuredClone(changes));
      return { changed: changes, settings: { overrides: [{ target: { kind: "book", bookId: "keep" }, paths: ["reading.fontSize"] }] } };
    } },
  } }, services: { storage }, contributions: {
    headerActions: { register: () => registrations.push("header") },
    commands: { register: () => registrations.push("command") },
    agentTools: { register: (tool: PluginToolDefinition) => { registrations.push("tool"); tools.set(tool.name, tool); } },
  } } as unknown as PluginContext;
  return { ctx, documents, revisions, updates, commits, tools, registrations, values, snapshots: () => snapshots, fail() { fail = true; } };
}
