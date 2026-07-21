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

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * Provider HTML is untrusted (feeds, remote articles): strip active content
 * before it reaches the reader iframe. Escape-interpolate everything else.
 */
function sanitizeSectionHtml(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<(iframe|object|embed|form)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, "")
    .replace(/(href|src)\s*=\s*(["']?)\s*javascript:[^"'\s>]*\2/gi, "");
}

function wrapSectionHtml(html: string, title: string | undefined, language: string): string {
  const lang = /^[A-Za-z-]{2,35}$/.test(language) ? language : "en";
  // The document-level CSP is the hard guarantee: with no script-src and
  // default-src 'none', no script executes in the section iframe even if the
  // regex strip above is bypassed. Inline styles stay allowed (foliate
  // injects the reader's styles as <style> elements); images may load.
  const csp =
    "default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
  return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">${title ? `<title>${escapeHtml(title)}</title>` : ""}</head>
<body>${title ? `<h2>${escapeHtml(title)}</h2>` : ""}${sanitizeSectionHtml(html)}</body>
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
