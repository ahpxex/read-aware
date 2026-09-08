import type { PluginModule } from "@read-aware/plugin-types";
import { assertCapabilities } from "./types";
import { jumperView } from "./views";
import { tr } from "./strings";

const plugin: PluginModule = {
  activate(ctx) {
    assertCapabilities(ctx);
    ctx.contributions.headerActions.register({ id: "jumper", title: "Jumper", icon: "magnifying-glass",
      surface: "reader", presentation: "popup", view: () => jumperView(ctx) });
    ctx.contributions.commands.register({ id: "open", title: "Jumper", icon: "magnifying-glass",
      keywords: "jump chapter text search navigation", run: async () => ({ view: await jumperView(ctx) }) });
    for (const direction of ["back", "forward"] as const) {
      ctx.contributions.commands.register({ id: direction, title: `Jumper: ${tr(ctx.locale, direction)}`,
        icon: direction === "back" ? "arrow-left" : "arrow-right",
        defaultShortcut: { key: direction === "back" ? "ArrowLeft" : "ArrowRight", alt: true },
        run: async () => {
          const session = await ctx.domains.reading.queries.session();
          await ctx.domains.reading.commands[direction]({ sessionId: session.sessionId ?? undefined });
        } });
    }
  },
};
export default plugin;
