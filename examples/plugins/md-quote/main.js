/**
 * Markdown Quote — an official example plugin.
 *
 * Demonstrates: a selection action with a silent (toast) outcome, a reader
 * header popup, a command-palette command opening a settings form, namespaced
 * storage, and the `service:clipboard` permission.
 */

/** @param {string} text @param {{ title: string, author?: string }} book @param {boolean} cite */
function toMarkdownQuote(text, book, cite) {
  const quoted = text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  if (!cite) return quoted;
  const author = book.author ? `${book.author}, ` : "";
  return `${quoted}\n>\n> — ${author}*${book.title}*`;
}

export default {
  /** @param {import("read-aware").PluginContext} ctx */
  activate(ctx) {
    const cite = () => ctx.storage.get("cite") !== false;

    ctx.ui.registerSelectionAction({
      id: "copy-quote",
      title: "Copy as Markdown quote",
      icon: "quotes",
      run: async (input) => {
        await ctx.clipboard.writeText(toMarkdownQuote(input.text, input.book, cite()));
        return { toast: "Copied as Markdown quote" };
      },
    });

    ctx.ui.registerHeaderAction({
      id: "book-info",
      title: "Quote preview",
      icon: "quotes",
      surface: "reader",
      view: (input) => ({
        kind: "markdown",
        title: "Markdown Quote",
        markdown: input.book
          ? `Selected passages copy as:\n\n${toMarkdownQuote("A passage from the book…", input.book, cite())}`
          : "Open a book to preview the quote format.",
      }),
    });

    ctx.ui.registerCommand({
      id: "settings",
      title: "Markdown Quote: settings",
      icon: "quotes",
      keywords: "quote markdown cite",
      run: () => ({
        view: {
          kind: "form",
          title: "Markdown Quote settings",
          fields: [
            {
              kind: "toggle",
              id: "cite",
              label: "Append a citation line",
              value: cite(),
            },
          ],
          submitLabel: "Save",
          onSubmit: (values) => {
            ctx.storage.set("cite", values.cite === true);
            return { close: true, toast: "Markdown Quote settings saved" };
          },
        },
      }),
    });
  },
};
