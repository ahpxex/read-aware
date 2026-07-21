/**
 * Builds a foliate-compatible book object from plugin-provided content —
 * `view.open()` accepts any object honoring the section/toc contract, which
 * is exactly how virtual (plugin-served) books read like real ones: same
 * pagination, selection, CFI annotations, and progress model.
 */

export type VirtualBookContent = {
  title?: string;
  author?: string;
  language?: string;
  sections: { id?: string; title?: string; html: string }[];
};

function wrapSectionHtml(html: string, title: string | undefined, language: string): string {
  return `<!DOCTYPE html>
<html lang="${language}">
<head><meta charset="utf-8">${title ? `<title>${title}</title>` : ""}</head>
<body>${title ? `<h2>${title}</h2>` : ""}${html}</body>
</html>`;
}

export function buildVirtualFoliateBook(content: VirtualBookContent): unknown {
  const language = content.language ?? "en";
  const ids = content.sections.map((section, index) => section.id || `sec-${index}`);
  const docs = content.sections.map((section) =>
    wrapSectionHtml(section.html, section.title, language),
  );

  const sections = content.sections.map((_section, index) => {
    let url: string | null = null;
    return {
      id: ids[index],
      linear: "yes",
      size: docs[index].length,
      load: async () =>
        (url ??= URL.createObjectURL(new Blob([docs[index]], { type: "text/html" }))),
      unload: () => {
        if (url) {
          URL.revokeObjectURL(url);
          url = null;
        }
      },
      createDocument: async () =>
        new DOMParser().parseFromString(docs[index], "text/html"),
    };
  });

  return {
    metadata: {
      title: content.title ?? "",
      author: content.author ?? "",
      language,
    },
    sections,
    toc: content.sections.map((section, index) => ({
      label: section.title || `${index + 1}`,
      href: ids[index],
    })),
    resolveHref: (href: string) => {
      const id = href.split("#")[0];
      const index = ids.indexOf(id);
      return { index: index < 0 ? 0 : index, anchor: () => null };
    },
    splitTOCHref: (href: string) => [href.split("#")[0], null],
    getTOCFragment: (doc: Document) => doc.documentElement,
  };
}
