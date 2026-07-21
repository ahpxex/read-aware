/**
 * Annotation Tools — an official example plugin.
 *
 * Demonstrates the AI mount point: tools registered here join the reading
 * agent's tool set as `plugin_annotation_tools_<name>`, callable in any chat.
 * Requires the `ai` permission (register) and `reading-data` (what the tools
 * actually read).
 */

export default {
  /** @param {import("read-aware").PluginContext} ctx */
  activate(ctx) {
    ctx.ai.registerTool({
      name: "count_annotations",
      label: "Count annotations",
      description:
        "Count the user's annotations (highlights, notes, asked questions), optionally scoped to one book by id.",
      parameters: {
        type: "object",
        properties: {
          bookId: {
            type: "string",
            description: "Book id to scope to; omit for the whole library.",
          },
        },
        additionalProperties: false,
      },
      execute: async (params) => {
        const bookId = typeof params.bookId === "string" ? params.bookId : undefined;
        const annotations = await ctx.reading.listAnnotations(
          bookId ? { bookId } : undefined,
        );
        return {
          total: annotations.length,
          highlights: annotations.filter((a) => a.kind === "highlight").length,
          notes: annotations.filter((a) => a.kind === "note").length,
          asks: annotations.filter((a) => a.kind === "ask").length,
        };
      },
    });

    ctx.ai.registerTool({
      name: "list_recent_annotations",
      label: "Recent annotations",
      description:
        "List the user's most recent annotations with their text, newest first.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Max entries to return (default 10).",
          },
        },
        additionalProperties: false,
      },
      execute: async (params) => {
        const limit =
          typeof params.limit === "number" && params.limit > 0
            ? Math.min(50, Math.floor(params.limit))
            : 10;
        const annotations = await ctx.reading.listAnnotations();
        return annotations
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, limit)
          .map((a) => ({
            bookId: a.bookId,
            kind: a.kind,
            text: a.text,
            note: a.content,
            createdAt: a.createdAt,
          }));
      },
    });
  },
};
