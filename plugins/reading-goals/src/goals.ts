import type { PluginContext } from "@read-aware/plugin-types";

export type Goal = { text: string; suggestMemory: boolean };
const key = (bookId: string) => `goal:${bookId}`;
export function readGoal(ctx: PluginContext, bookId: string): Goal | null {
  const value = ctx.services.storage.get<Goal>(key(bookId));
  if (value === null) return null;
  if (typeof value.text !== "string" || typeof value.suggestMemory !== "boolean") throw new Error("Invalid stored reading goal");
  return value;
}
export function saveGoal(ctx: PluginContext, bookId: string, goal: Goal): Promise<void> {
  return ctx.services.storage.set(key(bookId), goal);
}
export function clearGoal(ctx: PluginContext, bookId: string): Promise<void> {
  return ctx.services.storage.remove(key(bookId));
}
