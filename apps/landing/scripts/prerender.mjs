/**
 * Post-build prerendering: renders every static route with the SSR bundle
 * (dist-ssr/entry-server.js, built by `vite build --ssr`) and writes real
 * HTML into dist/, one `<path>/index.html` per route. Static hosting then
 * serves parseable HTML to crawlers and AI agents at every docs/blog URL,
 * while the browser boots the unchanged SPA on top.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(appDir, "dist");

const { render, staticPaths } = await import(
  join(appDir, "dist-ssr", "entry-server.js")
);

const template = await readFile(join(distDir, "index.html"), "utf8");
const paths = staticPaths();
const pathSet = new Set(paths);

const SITE_ORIGIN = "https://readaware.app";
// Locale prefixes must mirror src/lib/i18n.ts.
const LOCALES = [
  { locale: "en", prefix: "", hreflang: "en" },
  { locale: "zh", prefix: "/zh", hreflang: "zh-CN" },
  { locale: "ja", prefix: "/ja", hreflang: "ja" },
];

function localeOf(routePath) {
  return (
    LOCALES.find(
      ({ prefix }) =>
        prefix && (routePath === prefix || routePath.startsWith(`${prefix}/`)),
    ) ?? LOCALES[0]
  );
}

/** <link rel="alternate" hreflang> tags for pages that exist in every locale. */
function alternateLinks(routePath) {
  const { prefix } = localeOf(routePath);
  const base = prefix ? routePath.slice(prefix.length) || "/" : routePath;
  const variants = LOCALES.map((entry) => ({
    ...entry,
    path: entry.prefix ? `${entry.prefix}${base}` : base,
  })).filter((entry) => pathSet.has(entry.path));
  if (variants.length < 2) return "";
  const links = variants.map(
    (entry) =>
      `<link rel="alternate" hreflang="${entry.hreflang}" href="${SITE_ORIGIN}${entry.path}" />`,
  );
  links.push(
    `<link rel="alternate" hreflang="x-default" href="${SITE_ORIGIN}${base}" />`,
  );
  return `    ${links.join("\n    ")}\n  `;
}

for (const routePath of paths) {
  let body = await render(routePath);

  // <HeadContent /> emits the route's <title>/<meta name="description"> where
  // it sits in the body markup; lift them into the document head so parsers
  // and previews see per-page metadata, and drop the in-body copies.
  const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1];
  const description = body.match(/<meta[^>]*name="description"[^>]*>/)?.[0];
  body = body
    .replace(/<title[^>]*>[\s\S]*?<\/title>/g, "")
    .replace(/<meta[^>]*name="description"[^>]*>/g, "");

  let html = template.replace('<div id="root"></div>', () => {
    return `<div id="root">${body}</div>`;
  });
  if (title) {
    html = html.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${title}</title>`);
  }
  if (description) {
    html = html.replace(/<meta[^>]*name="description"[^>]*>/, () => description);
  }
  html = html.replace('<html lang="en">', () => {
    return `<html lang="${localeOf(routePath).hreflang}">`;
  });
  const alternates = alternateLinks(routePath);
  if (alternates) {
    html = html.replace("</head>", () => `${alternates}</head>`);
  }

  const outFile =
    routePath === "/"
      ? join(distDir, "index.html")
      : join(distDir, routePath.slice(1), "index.html");
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, html);
  console.log(`prerendered ${routePath} -> ${relative(appDir, outFile)}`);
}

console.log(`prerendered ${paths.length} routes`);
