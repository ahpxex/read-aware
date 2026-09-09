import type { PluginModule } from "@read-aware/plugin-types";
import type { ReaderPanelsSnapshot } from "@read-aware/core";

export default {
  activate(ctx) {
    const seen: (ReaderPanelsSnapshot | null)[] = [];
    ctx.services.ui.reader?.observe(snapshot => { seen.push(snapshot); if (seen.length > 20) seen.shift(); });
    ctx.contributions.commands.register({ id: "inspect", title: "Inspect authorized panels", run: async () => ({ toast: JSON.stringify({
      hasReader: !!ctx.services.ui.reader, hasWrite: !!ctx.services.ui.reader?.setPanel,
      snapshot: await ctx.services.ui.reader?.snapshot(), seen,
    }) }) });
    if (ctx.services.ui.reader?.setPanel) for (const panel of ["toc", "annotations", "appearance", "chat"] as const) for (const open of [true, false]) {
      ctx.contributions.commands.register({ id: `${panel}-${open}`, title: `${panel}-${open}`, run: async () => {
        const before = await ctx.services.ui.reader!.snapshot();
        if (!before) throw Error("No ready panels");
        const receipt = await ctx.services.ui.reader!.setPanel!(panel, open, { sessionId: before.sessionId, bookId: before.bookId });
        return { toast: JSON.stringify(receipt) };
      } });
    }
  },
} satisfies PluginModule;
