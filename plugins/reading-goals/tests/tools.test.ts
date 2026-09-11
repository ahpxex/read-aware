import { expect, test } from "bun:test";
import type { PluginModule, PluginMigrationContext, PluginMemoryCandidateProvider, PluginCommand } from "@read-aware/plugin-types";
import { fixture } from "./fixture";
import { readGoal, readGoalState, writeGoal } from "../src/goals";
import { goalsView } from "../src/views";
import { copy } from "../src/strings";
import plugin from "../src/index";
import manifest from "../manifest.json";

test("all three tools register in both scopes, with writes requiring host approval", async () => {
  const f = fixture();
  expect([...f.tools.keys()]).toEqual(["get_reading_goal", "set_reading_goal", "clear_reading_goal"]);
  for (const tool of f.tools.values()) expect(tool.contexts).toEqual(["book", "global"]);
  expect(f.tools.get("get_reading_goal")!.approval).toBeUndefined();
  expect(f.tools.get("set_reading_goal")!.approval).toBe("required");
  expect(f.tools.get("clear_reading_goal")!.approval).toBe("required");
  expect(manifest.requires.contributions.agentTools).toBe("^1.2.0");
  expect(manifest.requires.services.storage).toBe("^2.1.0");
  expect(manifest.requires.contributions.memoryCandidateProviders).toBe("^1.1.0");
  expect(manifest.permissions).toContain("agent:tools");
  const built = await Bun.build({ entrypoints: [new URL("../src/index.ts", import.meta.url).pathname], target: "browser" });
  expect(built.success).toBe(true);
  const compiled = (await import(`data:text/javascript;base64,${Buffer.from(await built.outputs[0]!.text()).toString("base64")}`)).default as PluginModule;
  let candidates!: PluginMemoryCandidateProvider;
  const commands = new Map<string, PluginCommand>();
  f.ctx.contributions.memoryCandidateProviders!.register = value => { candidates = value; return { dispose() {} }; };
  f.ctx.contributions.commands.register = value => { commands.set(value.id, value); return { dispose() {}, updateState: async () => ({ status: "applied" }) }; };
  f.tools.clear(); await compiled.activate(f.ctx);
  expect(f.tools.size).toBe(3); expect(f.tools.get("clear_reading_goal")!.approval).toBe("required");
  await f.tools.get("set_reading_goal")!.execute({ bookId: "book-1", text: "Compiled goal", suggestMemory: true, expectedRevision: null });
  expect(await candidates.propose({ requestId: "compiled", scope: { kind: "book", bookId: "book-1" }, userText: "q", assistantText: "a" }))
    .toEqual([{ scope: "book", kind: "preference", content: "Compiled goal" }]);
  await candidates.onResult!({ requestId: "compiled", discarded: 0, results: [{ index: 0, outcome: { status: "saved" } }] });
  expect(JSON.stringify(await commands.get("memory-status")!.run())).toContain("Saved to memory");
});

test("Agent writes feed the same next-turn context and opt-in candidates as UI", async () => {
  const f = fixture(), set = f.tools.get("set_reading_goal")!, clear = f.tools.get("clear_reading_goal")!;
  expect(await f.tools.get("get_reading_goal")!.execute({ bookId: "book-1" })).toEqual({ bookId: "book-1", goal: null, revision: null });
  f.state.bookId = "book-2";
  expect(await set.execute({ bookId: "book-1", text: "  Compare evidence  ", suggestMemory: false, expectedRevision: null })).toMatchObject({ status: "saved" });
  const input = { requestId: "request-1", scope: { kind: "book" as const, bookId: "book-1" }, userText: "question", assistantText: "answer" };
  expect(await f.context.provide(input)).toEqual([{ title: "Reading Goals", content: "Compare evidence" }]);
  expect(await f.candidates.propose(input)).toEqual([]);
  const original = await readGoalState(f.ctx, "book-1");
  await set.execute({ bookId: "book-1", text: "Remember the goal", suggestMemory: true, expectedRevision: original.revision });
  expect(await f.candidates.propose(input)).toEqual([{ scope: "book", kind: "preference", content: "Remember the goal" }]);
  expect(f.state.memory).toBe(true);
  expect(await clear.execute({ bookId: "book-1", expectedRevision: original.revision })).toMatchObject({ status: "conflict" });
  await clear.execute({ bookId: "book-1", expectedRevision: (await readGoalState(f.ctx, "book-1")).revision });
  expect(await f.context.provide(input)).toEqual([]); expect(await f.candidates.propose(input)).toEqual([]);
  expect(f.documents.has("book-2")).toBe(false);
  expect((await readGoalState(f.ctx, "book-1")).revision).not.toBeNull();
});

test("UI edits reject a goal changed by the Agent and do not recapture the active book", async () => {
  const f = fixture(), view = await goalsView(f.ctx, "book-1");
  if (view.kind !== "blocks") throw Error("Expected blocks");
  const form = view.blocks.find(block => block.kind === "form");
  if (form?.kind !== "form") throw Error("Expected form");
  await f.tools.get("set_reading_goal")!.execute({ bookId: "book-1", text: "Agent edit", suggestMemory: false, expectedRevision: null });
  f.state.bookId = "book-2";
  expect(JSON.stringify(await form.onSubmit({ goal: "Old form", suggestMemory: true }))).toContain("The goal changed");
  expect((await readGoal(f.ctx, "book-1"))!.text).toBe("Agent edit");
  f.missingBooks.add("book-2");
  await expect(writeGoal(f.ctx, "book-2", { text: "No book", suggestMemory: false }, null)).rejects.toMatchObject({ code: "library/book-not-found" });
});

test("legacy promotion is conditional, cleanup retries and tombstones prevent resurrection", async () => {
  const f = fixture(); f.saved.set("goal:book-1", { text: "Old goal", suggestMemory: true });
  f.state.failRemove = true;
  await expect(readGoalState(f.ctx, "book-1")).rejects.toThrow("cleanup failed");
  expect(f.documents.get("book-1")!.data).toEqual({ version: 1, goal: { text: "Old goal", suggestMemory: true } });
  const revision = f.documents.get("book-1")!.revision;
  f.state.failRemove = false;
  expect(await readGoalState(f.ctx, "book-1")).toMatchObject({ revision });
  expect(f.saved.size).toBe(0);
  await writeGoal(f.ctx, "book-1", null, revision);
  f.saved.set("goal:book-1", { text: "Restored old KV", suggestMemory: true });
  expect(await readGoal(f.ctx, "book-1")).toBeNull(); expect(f.saved.size).toBe(0);
  expect(f.commits.filter(batch => batch[0]!.expectedRevision === null)).toHaveLength(1);
});

test("unseen legacy goals cannot be overwritten by null-revision writes", async () => {
  const f = fixture(); f.saved.set("goal:book-1", { text: "Old goal", suggestMemory: false });
  expect(await f.tools.get("set_reading_goal")!.execute({ bookId: "book-1", text: "Replacement", suggestMemory: true, expectedRevision: null })).toMatchObject({ status: "conflict" });
  expect((await readGoal(f.ctx, "book-1"))!.text).toBe("Old goal");
  f.missingBooks.add("book-1");
  expect(await f.tools.get("clear_reading_goal")!.execute({ bookId: "book-1", expectedRevision: (await readGoalState(f.ctx, "book-1")).revision })).toMatchObject({ status: "cleared" });
});

test("simultaneous context reads promote a legacy goal without replacing the winning revision", async () => {
  const f = fixture(); f.saved.set("goal:book-1", { text: "Legacy", suggestMemory: false });
  const [first, second] = await Promise.all([readGoalState(f.ctx, "book-1"), readGoalState(f.ctx, "book-1")]);
  expect(first).toEqual(second); expect(first.revision).toBe("1");
  expect(f.documents.size).toBe(1); expect(f.saved.size).toBe(0);
});

test("invalid input, malformed legacy data and storage failures never report success", async () => {
  const f = fixture(), set = f.tools.get("set_reading_goal")!;
  for (const patch of [{ text: " " }, { text: "x".repeat(501) }, { suggestMemory: "yes" }, { expectedRevision: undefined }, { extra: true }, { bookId: "" }]) {
    await expect(set.execute({ bookId: "book-1", text: "Valid", suggestMemory: false, expectedRevision: null, ...patch }) as Promise<unknown>).rejects.toMatchObject({ code: "plugin/invalid-input" });
  }
  expect(f.commits).toHaveLength(0);
  f.saved.set("goal:book-1", { text: 123, suggestMemory: false });
  await expect(readGoalState(f.ctx, "book-1")).rejects.toMatchObject({ code: "plugin/invalid-input" });
  expect(f.saved.size).toBe(1); expect(f.documents.size).toBe(0);
  f.saved.clear(); f.state.failSave = true;
  await expect(set.execute({ bookId: "book-1", text: "Valid", suggestMemory: false, expectedRevision: null }) as Promise<unknown>).rejects.toThrow("storage failed");
  f.state.failRead = true;
  await expect(readGoalState(f.ctx, "book-1")).rejects.toThrow("read failed");
});

test("schema upgrade is lazy, downgrade is explicit, and feedback covers eight locales", () => {
  const context = {} as PluginMigrationContext;
  expect(() => plugin.migrate(context, { direction: "upgrade", fromVersion: 1, toVersion: 2 })).not.toThrow();
  expect(() => plugin.migrate(context, { direction: "downgrade", fromVersion: 2, toVersion: 1 })).toThrow("Unsupported");
  expect(manifest.schemaVersion).toBe(2);
  for (const locale of ["en", "zh-Hans", "zh-Hant", "ja", "de", "fr", "es", "ru"]) {
    const t = copy(locale); expect(t.saved).toBeTruthy(); expect(t.cleared).toBeTruthy(); expect(t.conflict).toBeTruthy(); expect(t.confirm).toBeTruthy();
  }
});
