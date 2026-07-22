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

  const outFile =
    routePath === "/"
      ? join(distDir, "index.html")
      : join(distDir, routePath.slice(1), "index.html");
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, html);
  console.log(`prerendered ${routePath} -> ${relative(appDir, outFile)}`);
}

console.log(`prerendered ${paths.length} routes`);
