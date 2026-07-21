/**
 * Shelf Report — an official example plugin.
 *
 * Demonstrates: a shelf header action registered as a full Page, the list
 * view with drill-down into a markdown detail, and the `reading-data`
 * permission (read-only books + annotations).
 */

/** @param {number | undefined} fraction */
function progressLabel(fraction) {
  if (typeof fraction !== "number" || Number.isNaN(fraction)) return "not started";
  return `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
}

export default {
  /** @param {import("read-aware").PluginContext} ctx */
  activate(ctx) {
    ctx.ui.registerHeaderAction({
      id: "report",
      title: "Shelf report",
      icon: "chart-line-up",
      surface: "shelf",
      presentation: "page",
      view: async () => {
        const books = await ctx.reading.listBooks();
        return {
          kind: "list",
          emptyText: "No books on the shelf yet.",
          items: books.map((book) => ({
            id: book.id,
            title: book.title,
            subtitle: `${book.author ?? "Unknown author"} · ${progressLabel(book.progressFraction)}`,
            icon: "book-open",
            onSelect: async () => {
              const annotations = await ctx.reading.listAnnotations({ bookId: book.id });
              const highlights = annotations.filter((a) => a.kind === "highlight").length;
              const notes = annotations.filter((a) => a.kind === "note").length;
              const asks = annotations.filter((a) => a.kind === "ask").length;
              return {
                view: {
                  kind: "markdown",
                  title: book.title,
                  markdown: [
                    `**${book.title}**`,
                    book.author ? `by ${book.author}` : null,
                    "",
                    `- Progress: ${progressLabel(book.progressFraction)}`,
                    `- Highlights: ${highlights}`,
                    `- Notes: ${notes}`,
                    `- Questions asked: ${asks}`,
                  ]
                    .filter((line) => line !== null)
                    .join("\n"),
                },
              };
            },
          })),
        };
      },
    });
  },
};
