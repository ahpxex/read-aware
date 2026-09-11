import type { PluginModule } from "@read-aware/plugin-types";
import { readGoal } from "./goals";
import { goalsView } from "./views";
import { copy } from "./strings";
import { readingTimeView } from "./time-view";
import { timeCopy } from "./time-strings";
import { readingInsightsForm } from "./insights-view";
import { insightsCopy } from "./insights-strings";
import { registerGoalTools } from "./tools";

export default {
  activate(ctx) {
    const { agentContextProviders, memoryCandidateProviders } = ctx.contributions;
    if (!ctx.domains.reading || !ctx.domains.library || !agentContextProviders || !memoryCandidateProviders) throw new Error("Reading Goals capabilities unavailable");
    const title = copy(ctx.locale).title;
    ctx.contributions.headerActions.register({ id: "goals", title, icon: "notebook", surface: "reader", presentation: "popup", view: () => goalsView(ctx) });
    ctx.contributions.commands.register({ id: "open", title, icon: "notebook", run: async () => ({ view: await goalsView(ctx) }) });
    ctx.contributions.headerActions.register({ id: "reading-time", title: timeCopy(ctx.locale).title, icon: "clock", surface: "shelf", presentation: "popup", view: () => readingTimeView(ctx) });
    ctx.contributions.commands.register({ id: "time", title: timeCopy(ctx.locale).title, icon: "clock", run: async () => ({ view: await readingTimeView(ctx) }) });
    ctx.contributions.commands.register({ id: "insights", title: insightsCopy(ctx.locale).title, icon: "chart-line-up", run: () => ({ view: readingInsightsForm(ctx) }) });
    registerGoalTools(ctx);
    agentContextProviders.register({ id: "reading-goal", contexts: ["book"], provide: async ({ scope }) => {
      const goal = scope.kind === "book" ? await readGoal(ctx, scope.bookId) : null;
      return goal ? [{ title, content: goal.text }] : [];
    } });
    memoryCandidateProviders.register({ id: "reading-goal", contexts: ["book"], propose: async ({ scope }) => {
      const goal = scope.kind === "book" ? await readGoal(ctx, scope.bookId) : null;
      return goal?.suggestMemory ? [{ scope: "book", kind: "preference", content: goal.text }] : [];
    } });
  },
  migrate(_ctx, migration) {
    // v2 promotes per-book v1 KV lazily; downgrade would hide newer document edits.
    if (migration.direction !== "upgrade" || migration.fromVersion > 1 || migration.toVersion !== 2) throw Error("Unsupported Reading Goals schema migration");
  },
} satisfies PluginModule;
