import { expect } from "bun:test";
import type { PluginAgentContextProvider, PluginContext, PluginDocumentChange, PluginMemoryCandidateProvider, PluginToolDefinition } from "@read-aware/plugin-types";
import plugin from "../src/index";

export function fixture() {
  const saved = new Map<string, unknown>();
  const documents = new Map<string, { data: unknown; revision: string }>();
  const tools = new Map<string, PluginToolDefinition>(), commits: PluginDocumentChange[][] = [];
  const state = { bookId: "book-1" as string | null, memory: true, failSave: false, failSettings: false, failRemove: false, failRead: false };
  const missingBooks = new Set<string>();
  let context!: PluginAgentContextProvider, candidates!: PluginMemoryCandidateProvider, revision = 0;
  const ctx = {
    locale: "en",
    domains: {
      reading: { queries: { session: async () => ({ bookId: state.bookId }) } },
      library: { queries: { books: { get: async (id: string) => missingBooks.has(id) ? null : ({ id, title: id }) } } },
      settings: { queries: { read: async () => ({ value: state.memory }) }, commands: { update: async (changes: { path: string; value: boolean }[]) => {
        expect(changes[0]?.path).toBe("ai.preferences.buildMemory");
        if (state.failSettings) throw new Error("settings failed"); state.memory = changes[0]!.value;
      } } },
    },
    services: { storage: {
      get: (key: string) => saved.get(key) ?? null,
      set: async (key: string, value: unknown) => { if (state.failSave) throw new Error("storage failed"); saved.set(key, value); },
      remove: async (key: string) => { if (state.failRemove) throw Error("cleanup failed"); saved.delete(key); },
      flush: async () => {},
      collection: (name: string) => ({ get: async (id: string) => {
        expect(name).toBe("goals");
        if (state.failRead) throw Error("read failed");
        const doc = documents.get(id);
        return doc ? { id, ...structuredClone(doc), bookId: id, updatedAt: "2026-09-11T00:00:00Z" } : null;
      } }),
      applyDocuments: async (changes: PluginDocumentChange[]) => {
        if (state.failSave) throw Error("storage failed");
        commits.push(structuredClone(changes));
        for (const [index, change] of changes.entries()) {
          expect(change.collection).toBe("goals");
          if ((documents.get(change.id)?.revision ?? null) !== change.expectedRevision) return { status: "conflict", index };
        }
        for (const change of changes) {
          if (change.kind !== "put") throw Error("Expected versioned goal/tombstone");
          documents.set(change.id, { data: structuredClone(change.data), revision: String(++revision) });
        }
        return { status: "applied", documents: changes.map(change => ({ collection: change.collection, id: change.id, revision: documents.get(change.id)!.revision })) };
      },
    } },
    contributions: {
      headerActions: { register() {} }, commands: { register() {} },
      agentTools: { register(tool: PluginToolDefinition) { tools.set(tool.name, tool); } },
      agentContextProviders: { register(value: PluginAgentContextProvider) { context = value; } },
      memoryCandidateProviders: { register(value: PluginMemoryCandidateProvider) { candidates = value; } },
    },
  } as unknown as PluginContext;
  plugin.activate(ctx);
  return { ctx, state, saved, documents, commits, tools, missingBooks, context, candidates };
}
