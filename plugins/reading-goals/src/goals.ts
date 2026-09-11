import type { PluginContext } from "@read-aware/plugin-types";

export type Goal = { text: string; suggestMemory: boolean };
type GoalRecord = { version: 1; goal: Goal | null };
export type GoalState = { bookId: string; goal: Goal | null; revision: string | null };
const key = (bookId: string) => `goal:${bookId}`;
const invalid = (): never => { throw Object.assign(Error("Invalid reading goal"), { code: "plugin/invalid-input" }); };
export function goalBookId(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 512) return invalid();
  return value;
}
export function parseGoal(value: unknown): Goal {
  if (!value || typeof value !== "object") return invalid();
  const goal = value as Goal;
  if (typeof goal.text !== "string" || !goal.text.trim() || goal.text.trim().length > 500 || typeof goal.suggestMemory !== "boolean") return invalid();
  return { text: goal.text.trim(), suggestMemory: goal.suggestMemory };
}
export async function readGoalState(ctx: PluginContext, input: string): Promise<GoalState> {
  const bookId = goalBookId(input), storage = ctx.services.storage, collection = storage.collection("goals");
  let doc = await collection.get<GoalRecord>(bookId);
  if (!doc) {
    await storage.flush();
    const legacy = storage.get(key(bookId));
    if (legacy !== null) {
      const goal = parseGoal(legacy);
      // Promote on first access: the migration context cannot enumerate old KV keys.
      await storage.applyDocuments([{ kind: "put", collection: "goals", id: bookId, bookId,
        data: { version: 1, goal } satisfies GoalRecord, expectedRevision: null }]);
      doc = await collection.get<GoalRecord>(bookId);
      if (!doc) throw Object.assign(Error("Goal promotion disappeared"), { code: "plugin/unavailable" });
    }
  }
  if (!doc) return { bookId, goal: null, revision: null };
  if (doc.data?.version !== 1) return invalid();
  const goal = doc.data.goal === null ? null : parseGoal(doc.data.goal);
  // New records, including cleared tombstones, always supersede old KV values.
  // A failed cleanup rejects; the next read retries without reimporting old text.
  if (storage.get(key(bookId)) !== null) await storage.remove(key(bookId));
  return { bookId, goal, revision: doc.revision };
}
export async function readGoal(ctx: PluginContext, bookId: string): Promise<Goal | null> {
  return (await readGoalState(ctx, bookId)).goal;
}
export async function writeGoal(ctx: PluginContext, input: string, goal: Goal | null, expectedRevision: string | null) {
  const bookId = goalBookId(input), value = goal === null ? null : parseGoal(goal);
  if (expectedRevision !== null && (typeof expectedRevision !== "string" || !expectedRevision.trim() || expectedRevision.length > 512)) return invalid();
  if (value !== null && !await ctx.domains.library!.queries.books.get(bookId)) {
    throw Object.assign(Error("Goal book is no longer available"), { code: "library/book-not-found" });
  }
  const receipt = await ctx.services.storage.applyDocuments([{ kind: "put", collection: "goals", id: bookId, bookId,
    data: { version: 1, goal: value } satisfies GoalRecord, expectedRevision }]);
  return { status: receipt.status === "conflict" ? "conflict" as const : value === null ? "cleared" as const : "saved" as const, bookId };
}
