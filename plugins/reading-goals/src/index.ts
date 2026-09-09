import type { PluginModule } from "@read-aware/plugin-types";
import { readGoal } from "./goals";
import { goalsView } from "./views";
import { copy } from "./strings";

export default {
  activate(ctx) {
    const { agentContextProviders, memoryCandidateProviders } = ctx.contributions;
    if (!ctx.domains.reading || !ctx.domains.library || !agentContextProviders || !memoryCandidateProviders) throw new Error("Reading Goals capabilities unavailable");
    const title = copy(ctx.locale).title;
    ctx.contributions.headerActions.register({ id: "goals", title, icon: "notebook", surface: "reader", presentation: "popup", view: () => goalsView(ctx) });
    ctx.contributions.commands.register({ id: "open", title, icon: "notebook", run: async () => ({ view: await goalsView(ctx) }) });
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
