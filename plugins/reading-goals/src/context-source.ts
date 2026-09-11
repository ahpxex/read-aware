import type { PluginAgentContextProvider, PluginContext } from "@read-aware/plugin-types";
import { goalBookId, parseGoal, readGoalState } from "./goals";

/** Migration belongs to preparation; the captured read never promotes old KV. */
export function readingGoalSource(ctx: PluginContext): NonNullable<PluginAgentContextProvider["readingIntent"]> {
  const book = (scope: Parameters<NonNullable<PluginAgentContextProvider["readingIntent"]>["read"]>[0]) => {
    if (scope.kind !== "book") throw Object.assign(Error("Reading Goals has no user-wide intention"), { code: "plugin/invalid-input" });
    return goalBookId(scope.id);
  };
  return {
    scopes: ["book"],
    prepare: async scope => { await readGoalState(ctx, book(scope)); await ctx.services.storage.flush(); },
    read: async scope => {
      const id = book(scope), storage = ctx.services.storage;
      const doc = await storage.collection("goals").get<{ version: 1; goal: unknown }>(id);
      if (!doc) {
        if (await storage.getDurable(`goal:${id}`) !== null) throw Object.assign(Error("Goal migration required before capture"), { code: "memory/conflict" });
        return { revision: null, text: null };
      }
      if (doc.data?.version !== 1) throw Object.assign(Error("Invalid reading goal record"), { code: "plugin/invalid-input" });
      return { revision: doc.revision, text: doc.data.goal === null ? null : parseGoal(doc.data.goal).text };
    },
  };
}
