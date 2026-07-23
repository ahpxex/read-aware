/**
 * Shelf Report — an official example plugin.
 *
 * Demonstrates: a searchable host list, semantic detail/metadata, responsive
 * columns, and read access across three domains (`books:read`, `reading:read`,
 * `annotations:read`).
 */

/** @param {number | undefined} percent */
function progressLabel(percent) {
  if (typeof percent !== "number" || Number.isNaN(percent) || percent <= 0) {
    return "not started";
  }
  return `${Math.round(Math.min(100, Math.max(0, percent)))}%`;
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
        const [books, states] = await Promise.all([
          ctx.books.list(),
          ctx.reading.listStates(),
        ]);
        const progressByBook = new Map(states.map((s) => [s.bookId, s.progressPercent]));
        return {
          kind: "list",
          emptyText: "No books on the shelf yet.",
          searchable: true,
          searchPlaceholder: "Search shelf report",
          items: books.map((book) => ({
            id: book.id,
            title: book.title,
            subtitle: book.author ?? "Unknown author",
            icon: "book-open",
            keywords: [book.author ?? "", book.format],
            accessories: [
              { kind: "tag", text: progressLabel(progressByBook.get(book.id)) },
            ],
            onSelect: async () => {
              const annotations = await ctx.annotations.list({ bookId: book.id });
              const highlights = annotations.filter((a) => a.kind === "highlight").length;
              const notes = annotations.filter((a) => a.kind === "note").length;
              const asks = annotations.filter((a) => a.kind === "ask").length;
              return {
                view: {
                  kind: "detail",
                  title: book.title,
                  content: [
                    {
                      kind: "columns",
                      cells: [
                        { blocks: [{ kind: "metric", label: "Highlights", value: String(highlights) }] },
                        { blocks: [{ kind: "metric", label: "Notes", value: String(notes) }] },
                        { blocks: [{ kind: "metric", label: "Questions", value: String(asks) }] },
                      ],
                    },
                    {
                      kind: "progress",
                      label: "Reading progress",
                      value: progressByBook.get(book.id) ?? 0,
                      showValue: true,
                    },
                  ],
                  metadata: [
                    ...(book.author
                      ? [{ kind: "label", label: "Author", value: book.author }]
                      : []),
                    { kind: "label", label: "Format", value: book.format.toUpperCase() },
                  ],
                },
              };
            },
          })),
        };
      },
    });
  },
};
