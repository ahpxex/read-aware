import type { PluginModule } from "@read-aware/plugin-types";
import { readGoal } from "./goals";
import { goalsView } from "./views";
import { copy } from "./strings";
import { readingTimeView } from "./time-view";
import { timeCopy } from "./time-strings";

export default {
  activate(ctx) {
    const { agentContextProviders, memoryCandidateProviders } = ctx.contributions;
    if (!ctx.domains.reading || !ctx.domains.library || !agentContextProviders || !memoryCandidateProviders) throw new Error("Reading Goals capabilities unavailable");
    const title = copy(ctx.locale).title;
    ctx.contributions.headerActions.register({ id: "goals", title, icon: "notebook", surface: "reader", presentation: "popup", view: () => goalsView(ctx) });
    ctx.contributions.commands.register({ id: "open", title, icon: "notebook", run: async () => ({ view: await goalsView(ctx) }) });
    ctx.contributions.headerActions.register({ id: "reading-time", title: timeCopy(ctx.locale).title, icon: "clock", surface: "shelf", presentation: "popup", view: () => readingTimeView(ctx) });
    ctx.contributions.commands.register({ id: "time", title: timeCopy(ctx.locale).title, icon: "clock", run: async () => ({ view: await readingTimeView(ctx) }) });
    agentContextProviders.register({ id: "reading-goal", contexts: ["book"], provide: ({ scope }) => {
      const goal = scope.kind === "book" ? readGoal(ctx, scope.bookId) : null;
      return goal ? [{ title, content: goal.text }] : [];
    } });
    memoryCandidateProviders.register({ id: "reading-goal", contexts: ["book"], propose: ({ scope }) => {
      const goal = scope.kind === "book" ? readGoal(ctx, scope.bookId) : null;
      return goal?.suggestMemory ? [{ scope: "book", kind: "preference", content: goal.text }] : [];
    } });
  },
} satisfies PluginModule;
