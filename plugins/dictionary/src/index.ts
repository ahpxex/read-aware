/**
 * Dictionary: ReadAware's first-party dictionary plugin.
 *
 * The plugin owns saved words and agent tools while the host owns every visual
 * component. This source is bundled to one dependency-free ES module for the
 * same runtime path used by third-party plugins.
 */
import type { PluginModule } from "@read-aware/plugin-types";
import { registerAgentTools } from "./agent-tools";
import { idFor } from "./format";
import { assertPluginCapabilities, type SavedWord } from "./types";
import { notebookView, wordDetailView } from "./views";
import { saveWord, wordCollection } from "./words";

const plugin: PluginModule = {
  activate(ctx) {
    assertPluginCapabilities(ctx);

    ctx.ui.registerSelectionAction({
      id: "lookup-save",
      title: "Look up",
      icon: "book-bookmark",
      role: "lookup",
      presentation: "dialog",
      run: async (input) => {
        const { term, language } = await saveWord(ctx, {
          text: input.text,
          context: input.context ?? input.text.trim().slice(0, 300),
          bookId: input.book.id,
          bookTitle: input.book.title,
        });
        const doc = await wordCollection(ctx).get<SavedWord>(idFor(term, language));
        if (!doc) throw new Error(`Could not load saved word “${term}”`);
        return {
          toast: `Saved “${term}”`,
          view: await wordDetailView(ctx, doc),
        };
      },
    });

    ctx.ui.registerHeaderAction({
      // Kept stable so existing pinned-layout preferences continue to resolve.
      id: "vocabulary",
      title: "Dictionary",
      icon: "book-bookmark",
      surface: "shelf",
      presentation: "page",
      view: () => notebookView(ctx),
    });

    ctx.ui.registerCommand({
      id: "open",
      title: "Dictionary: saved words",
      icon: "book-bookmark",
      keywords: "saved words dictionary notebook",
      run: async () => ({ view: await notebookView(ctx) }),
    });

    registerAgentTools(ctx);
  },
};

export default plugin;
