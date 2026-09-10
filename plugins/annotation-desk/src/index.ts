import type { PluginModule } from "@read-aware/plugin-types";
import { tr } from "./strings";
import { assertCapabilities } from "./types";
import { deskView } from "./views";
import { selectionCreationView } from "./creation";

const plugin: PluginModule = {
  activate(ctx) {
    assertCapabilities(ctx);
    const title = tr(ctx.locale, "title");
    for (const kind of ["note", "highlight"] as const) ctx.contributions.selectionActions.register({
      id: `create-${kind}`, title: tr(ctx.locale, kind === "note" ? "newNote" : "newHighlight"),
      icon: kind === "note" ? "note-pencil" : "highlighter", presentation: "dialog",
      run: input => {
        const bookId = input.book.id;
        return { view: selectionCreationView(ctx, input, kind, async () => ({
          view: await deskView(ctx, { bookId, previous: [] }), navigation: "reset",
        })) };
      },
    });
    ctx.contributions.headerActions.register({ id: "shelf", title, icon: "note-pencil", surface: "shelf", presentation: "page",
      view: () => deskView(ctx) });
    ctx.contributions.headerActions.register({ id: "reader", title, icon: "note-pencil", surface: "reader", presentation: "popup",
      view: input => deskView(ctx, { bookId: input.book?.id, previous: [] }) });
    ctx.contributions.commands.register({ id: "open", title, icon: "note-pencil", keywords: "annotation note highlight organize export",
      run: async () => {
        const session = await ctx.domains.reading.queries.session();
        return { view: await deskView(ctx, { bookId: session.bookId ?? undefined, previous: [] }) };
      } });
  },
};
export default plugin;
