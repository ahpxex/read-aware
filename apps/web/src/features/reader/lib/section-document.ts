/**
 * Section documents for books the app assembles itself (plugin-served virtual
 * books, plain text, single-file HTML). foliate loads every section as its own
 * document in a sandboxed iframe, so each one ships as a complete HTML
 * document with a locked-down CSP.
 */

export const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * Section HTML is untrusted (plugin feeds, remote articles, arbitrary imported
 * files): strip active content before it reaches the reader iframe.
 */
export function sanitizeSectionHtml(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<(iframe|object|embed|form)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, "")
    .replace(/(href|src)\s*=\s*(["']?)\s*javascript:[^"'\s>]*\2/gi, "");
}

export function wrapSectionHtml(
  html: string,
  title: string | undefined,
  language: string,
  extraStyle = "",
): string {
  const lang = /^[A-Za-z-]{2,35}$/.test(language) ? language : "en";
  // The document-level CSP is the hard guarantee: with no script-src and
  // default-src 'none', no script executes in the section iframe even if the
  // regex strip above is bypassed. Inline styles stay allowed (foliate
  // injects the reader's styles as <style> elements); images may load.
  const csp =
    "default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
  return `<!DOCTYPE html>
<html lang="${lang}">
<head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}">${title ? `<title>${escapeHtml(title)}</title>` : ""}${extraStyle ? `<style>${extraStyle}</style>` : ""}</head>
<body>${title ? `<h2>${escapeHtml(title)}</h2>` : ""}${sanitizeSectionHtml(html)}</body>
</html>`;
}
