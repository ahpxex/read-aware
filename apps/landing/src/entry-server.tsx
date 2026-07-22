/**
 * Build-time prerendering entry (scripts/prerender.mjs). The landing is a
 * static SPA, which means the shipped HTML is an empty `<div id="root">` —
 * unreadable to crawlers and AI agents that don't execute JavaScript. This
 * module renders any route to real HTML with react-dom/server; the prerender
 * script writes the result to `dist/<path>/index.html` so every page is
 * parseable from its plain HTTP response. The browser still boots the normal
 * SPA on top (main.tsx).
 */
import { renderToString } from "react-dom/server";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { createAppRouter } from "./router";

/**
 * Every concrete route path in the tree, "/" included. `routesByPath` keys
 * are already canonical ("/docs", not "/docs/"). All landing routes are
 * static (no `$param` segments); if a dynamic route ever appears it is
 * skipped here and keeps working purely client-side.
 */
export function staticPaths(): string[] {
  const router = createAppRouter();
  return Object.keys(router.routesByPath)
    .filter((path) => !path.includes("$"))
    .sort();
}

export async function render(url: string): Promise<string> {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  await router.load();
  return renderToString(<RouterProvider router={router} />);
}
