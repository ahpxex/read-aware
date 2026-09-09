import { expect, test } from "bun:test";
import type { PluginAgentContextProvider, PluginContext, PluginFormView, PluginMemoryCandidateProvider } from "@read-aware/plugin-types";
import plugin from "../src/index";
import { goalsView } from "../src/views";

function fixture() {
  const saved = new Map<string, unknown>();
  const state = { bookId: "book-1" as string | null, memory: true, failSave: false, failSettings: false };
  let context!: PluginAgentContextProvider, candidates!: PluginMemoryCandidateProvider;
  const ctx = {
    locale: "en",
    domains: {
      reading: { queries: { session: async () => ({ bookId: state.bookId }) } },
      library: { queries: { books: { get: async (id: string) => ({ id, title: id }) } } },
      settings: { queries: { read: async () => ({ value: state.memory }) }, commands: { update: async (changes: { path: string; value: boolean }[]) => {
        expect(changes[0]?.path).toBe("ai.preferences.buildMemory");
        if (state.failSettings) throw new Error("settings failed"); state.memory = changes[0]!.value;
      } } },
    },
    services: { storage: {
      get: (key: string) => saved.get(key) ?? null,
      set: async (key: string, value: unknown) => { if (state.failSave) throw new Error("storage failed"); saved.set(key, value); },
      remove: async (key: string) => { saved.delete(key); },
    } },
    contributions: {
      headerActions: { register() {} }, commands: { register() {} },
      agentContextProviders: { register(value: PluginAgentContextProvider) { context = value; } },
      memoryCandidateProviders: { register(value: PluginMemoryCandidateProvider) { candidates = value; } },
    },
  } as unknown as PluginContext;
  plugin.activate(ctx);
  return { ctx, state, saved, context, candidates };
}

async function forms(ctx: PluginContext): Promise<PluginFormView[]> {
  const view = await goalsView(ctx);
  if (view.kind !== "blocks") throw new Error("Expected blocks");
  return view.blocks.filter(block => block.kind === "form");
}

test("goal forms validate, await storage, and retain the displayed book when reading moves", async () => {
  const { ctx, state, saved } = fixture();
  const [form] = await forms(ctx);
  for (const goal of [" ", "x".repeat(501)]) expect(await form!.onSubmit({ goal, suggestMemory: false })).toHaveProperty("fieldErrors.goal");
  expect(saved.size).toBe(0);
  state.bookId = "book-2";
  await form!.onSubmit({ goal: "  Understand the argument  ", suggestMemory: true });
  expect(saved.get("goal:book-1")).toEqual({ text: "Understand the argument", suggestMemory: true });
  expect(saved.has("goal:book-2")).toBe(false);
  state.failSave = true;
  await expect(form!.onSubmit({ goal: "replacement", suggestMemory: false })).rejects.toThrow("storage failed");
  expect(saved.get("goal:book-1")).toHaveProperty("text", "Understand the argument");
});

test("context and opt-in candidates use the requested book, never the active reader or another scope", async () => {
  const { ctx, state, context, candidates } = fixture();
  const [form] = await forms(ctx);
  await form!.onSubmit({ goal: "Compare evidence", suggestMemory: false });
  const input = { scope: { kind: "book" as const, bookId: "book-1" }, userText: "question", assistantText: "answer" };
  state.bookId = "book-2";
  expect(await context.provide(input)).toEqual([{ title: "Reading Goals", content: "Compare evidence" }]);
  expect(await candidates.propose(input)).toEqual([]);
  await form!.onSubmit({ goal: "Compare evidence", suggestMemory: true });
  expect(await candidates.propose(input)).toEqual([{ scope: "book", kind: "preference", content: "Compare evidence" }]);
  expect(await context.provide({ ...input, scope: { kind: "book", bookId: "book-2" } })).toEqual([]);
  expect(await candidates.propose({ ...input, scope: { kind: "global", threadId: "x" } })).toEqual([]);
});

test("host policy writes are independent of goal storage and failures are not presented as success", async () => {
  const { ctx, state, saved } = fixture();
  const [, form] = await forms(ctx);
  await form!.onSubmit({ enabled: false });
  expect(state.memory).toBe(false); expect(saved.size).toBe(0);
  state.failSettings = true;
  await expect(form!.onSubmit({ enabled: true })).rejects.toThrow("settings failed");
  expect(state.memory).toBe(false);
});

test("clear removes only this book's goal and no-book is an explicit state", async () => {
  const { ctx, saved, state } = fixture();
  saved.set("goal:book-1", { text: "one", suggestMemory: true });
  saved.set("goal:book-2", { text: "two", suggestMemory: false });
  const view = await goalsView(ctx);
  if (view.kind !== "blocks") throw new Error("Expected blocks");
  const actions = view.blocks.find(block => block.kind === "actions");
  if (actions?.kind !== "actions") throw new Error("Expected actions");
  await actions.actions.find(action => action.id === "clear")!.run();
  expect(saved.has("goal:book-1")).toBe(false); expect(saved.has("goal:book-2")).toBe(true);
  state.bookId = null;
  expect(JSON.stringify(await goalsView(ctx))).toContain("No book is open");
});
